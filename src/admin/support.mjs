import {randomUUID,timingSafeEqual} from 'node:crypto';
import {cookieValue,hashToken,sameOrigin} from '../auth/security.mjs';
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
async function parse(req){
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')) throw Error('invalid');
  let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)throw Error('invalid');chunks.push(chunk);}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body||typeof body!=='object'||Array.isArray(body))throw Error('invalid');return body;
}
export async function handleSupport(req,res,pool,path){
  const statusAction=/^\/api\/admin\/support\/([1-9][0-9]{0,19})\/status$/.exec(path);
  const detail=statusAction || /^\/api\/admin\/support\/([1-9][0-9]{0,19})$/.exec(path);
  if(path!=='/api/admin/support'&&!detail)return false;
  if(!['GET','POST'].includes(req.method)||(req.method==='POST'&&!detail)||(statusAction&&req.method!=='POST')){send(res,405,{error:'Method not allowed.'});return true;}
  if(req.method==='POST'&&!sameOrigin(req)){send(res,403,{error:'Invalid request origin.'});return true;}
  if(!pool){send(res,503,{error:'Service unavailable.'});return true;}
  const token=cookieValue(req.headers.cookie,'pall_session');if(!token){send(res,401,{error:'Please sign in.'});return true;}
  let input;
  if(req.method==='POST'){
    try{input=await parse(req);}catch{send(res,400,{error:'Invalid request.'});return true;}
    if(statusAction) {
      if(typeof input.expectedStatus!=='string'||typeof input.status!=='string'){send(res,400,{error:'Invalid status.'});return true;}
    } else if(typeof input.message!=='string'||input.message.trim().length<5||input.message.trim().length>3000||typeof input.private!=='boolean'||typeof input.operationKey!=='string'||!/^[a-zA-Z0-9_-]{16,64}$/.test(input.operationKey)){send(res,400,{error:'Invalid reply.'});return true;}
    if(!statusAction) input.message=input.message.trim();
  }
  let conn;
  try{
    conn=await pool.getConnection();await conn.beginTransaction();
    const [users]=await conn.execute("SELECT CAST(u.id AS CHAR) AS id,s.csrf_hash FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(6) AND u.status='ACTIVE' FOR UPDATE",[hashToken(token)]);
    if(!users.length){await conn.rollback();send(res,401,{error:'Please sign in.'});return true;}
    const user=users[0];
    if(req.method==='POST'){
      const csrf=req.headers['x-csrf-token'];const actual=typeof csrf==='string'&&/^[A-Za-z0-9_-]{43}$/.test(csrf)?Buffer.from(hashToken(csrf),'hex'):Buffer.alloc(0);const expected=Buffer.from(user.csrf_hash,'hex');
      if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){await conn.rollback();send(res,403,{error:'Invalid security token.'});return true;}
    }
    const permission=statusAction?'admin.support.status':req.method==='POST'?'admin.support.reply':'admin.support.read';
    const [grants]=await conn.execute("SELECT p.id FROM users u JOIN role_permissions rp ON rp.role_id=u.role_id JOIN permissions p ON p.id=rp.permission_id WHERE u.id=? AND u.status='ACTIVE' AND p.name=? FOR UPDATE",[user.id,permission]);
    if(!grants.length){await conn.rollback();send(res,403,{error:'Permission denied.'});return true;}
    if(!detail){
      const params=new URL(req.url,'http://internal').searchParams,pageText=params.get('page')||'1',search=(params.get('search')||'').trim();
      if(!/^[1-9][0-9]{0,4}$/.test(pageText)||search.length>100){await conn.rollback();send(res,400,{error:'Invalid filter.'});return true;}
      const page=Number(pageText),offset=(page-1)*20,term=`%${search.replace(/[!%_]/g,c=>'!'+c)}%`;
      const [[count]]=await conn.execute("SELECT COUNT(*) AS total FROM support_tickets WHERE subject LIKE ? ESCAPE '!'",[term]);
      const [items]=await conn.execute(`SELECT CAST(id AS CHAR) AS id,CAST(user_id AS CHAR) AS user_id,subject,category,status,created_at FROM support_tickets WHERE subject LIKE ? ESCAPE '!' ORDER BY id DESC LIMIT 20 OFFSET ${offset}`,[term]);
      await conn.execute("INSERT INTO audit_logs (actor_id,action,target_type,target_id,correlation_id) VALUES (?,'ADMIN_VIEW','support','list',?)",[user.id,randomUUID()]);
      await conn.commit();send(res,200,{items,total:Number(count.total),page,pageSize:20});return true;
    }
    const [tickets]=await conn.execute('SELECT CAST(id AS CHAR) AS id,CAST(user_id AS CHAR) AS user_id,subject,category,status,created_at FROM support_tickets WHERE id=? FOR UPDATE',[detail[1]]);
    if(!tickets.length){await conn.rollback();send(res,404,{error:'Ticket not found.'});return true;}
    const ticket=tickets[0];
    if(req.method==='GET'){
      const [messages]=await conn.execute('SELECT CAST(id AS CHAR) AS id,CAST(author_id AS CHAR) AS author_id,body,is_private,created_at FROM support_messages WHERE ticket_id=? ORDER BY id ASC LIMIT 100',[ticket.id]);
      await conn.execute("INSERT INTO audit_logs (actor_id,action,target_type,target_id,correlation_id) VALUES (?,'SUPPORT_VIEW','ticket',?,?)",[user.id,ticket.id,randomUUID()]);
      await conn.commit();send(res,200,{ticket,messages});return true;
    }
    if(statusAction){
      const transitions={OPEN:['IN_PROGRESS','RESOLVED','CLOSED'],IN_PROGRESS:['WAITING_FOR_CUSTOMER','RESOLVED','CLOSED'],WAITING_FOR_CUSTOMER:['IN_PROGRESS','RESOLVED','CLOSED'],RESOLVED:['IN_PROGRESS','CLOSED'],CLOSED:[]};
      if(!Object.hasOwn(transitions,input.expectedStatus)||!transitions[input.expectedStatus].includes(input.status)){await conn.rollback();send(res,400,{error:'Invalid status transition.'});return true;}
      if(ticket.status!==input.expectedStatus){await conn.rollback();send(res,409,{error:'Ticket status changed. Refresh and try again.'});return true;}
      await conn.execute('UPDATE support_tickets SET status=?,updated_at=UTC_TIMESTAMP(6) WHERE id=?',[input.status,ticket.id]);
      await conn.execute('INSERT INTO support_status_events (ticket_id,actor_id,from_status,to_status) VALUES (?,?,?,?)',[ticket.id,user.id,ticket.status,input.status]);
      await conn.execute("INSERT INTO notifications (user_id,category,title,reference_type,reference_id) VALUES (?,'SUPPORT','Support ticket status updated','ticket',?)",[ticket.user_id,ticket.id]);
      await conn.execute("INSERT INTO audit_logs (actor_id,action,target_type,target_id,correlation_id) VALUES (?,'SUPPORT_STATUS_CHANGED','ticket',?,?)",[user.id,ticket.id,randomUUID()]);
      await conn.commit();send(res,200,{status:input.status});return true;
    }
    const [existing]=await conn.execute('SELECT CAST(author_id AS CHAR) AS author_id,body,is_private FROM support_messages WHERE ticket_id=? AND operation_key=?',[ticket.id,input.operationKey]);
    if(existing.length){const e=existing[0];if(e.author_id!==user.id||e.body!==input.message||Boolean(e.is_private)!==input.private){await conn.rollback();send(res,409,{error:'Idempotency conflict.'});return true;}await conn.commit();send(res,200,{ok:true,replayed:true});return true;}
    if(['RESOLVED','CLOSED'].includes(ticket.status)){await conn.rollback();send(res,409,{error:'Ticket is closed.'});return true;}
    await conn.execute('INSERT INTO support_messages (ticket_id,author_id,body,is_private,operation_key) VALUES (?,?,?,?,?)',[ticket.id,user.id,input.message,input.private,input.operationKey]);
    if(input.private) await conn.execute('UPDATE support_tickets SET updated_at=UTC_TIMESTAMP(6) WHERE id=?',[ticket.id]);
    else {
      await conn.execute("UPDATE support_tickets SET status='WAITING_FOR_CUSTOMER',updated_at=UTC_TIMESTAMP(6) WHERE id=?",[ticket.id]);
      await conn.execute("INSERT INTO notifications (user_id,category,title,reference_type,reference_id) VALUES (?,'SUPPORT','New support reply','ticket',?)",[ticket.user_id,ticket.id]);
    }
    await conn.execute("INSERT INTO audit_logs (actor_id,action,target_type,target_id,correlation_id) VALUES (?,?,'ticket',?,?)",[user.id,input.private?'SUPPORT_PRIVATE_NOTE':'SUPPORT_REPLY',ticket.id,randomUUID()]);
    await conn.commit();send(res,201,{ok:true,replayed:false});return true;
  }catch{if(conn){try{await conn.rollback();}catch{}}send(res,503,{error:'Service unavailable.'});return true;}
  finally{if(conn)conn.release();}
}
