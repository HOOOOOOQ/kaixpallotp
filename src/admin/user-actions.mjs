import {randomUUID,timingSafeEqual} from 'node:crypto';
import {cookieValue,hashToken,sameOrigin} from '../auth/security.mjs';
const reply=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};

// Status updates, session revocation and audit entry commit together. Role grants
// are resolved from the database and locked in the same transaction.
export async function handleUserAction(req,res,pool,path) {
  const match=/^\/api\/admin\/users\/([1-9][0-9]{0,19})\/(suspend|restore)$/.exec(path);
  if(!match) return false;
  if(req.method!=='POST'){reply(res,405,{error:'Method not allowed.'});return true;}
  if(!sameOrigin(req)){reply(res,403,{error:'Invalid request origin.'});return true;}
  if(!pool){reply(res,503,{error:'Service unavailable.'});return true;}
  const token=cookieValue(req.headers.cookie,'pall_session');
  if(!token){reply(res,401,{error:'Please sign in.'});return true;}
  let conn;
  try {
    conn=await pool.getConnection(); await conn.beginTransaction();
    const [actors]=await conn.execute("SELECT CAST(u.id AS CHAR) AS id,s.csrf_hash FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(6) AND u.status='ACTIVE' FOR UPDATE",[hashToken(token)]);
    if(!actors.length){await conn.rollback();reply(res,401,{error:'Please sign in.'});return true;}
    const actor=actors[0], csrf=req.headers['x-csrf-token'];
    if(typeof csrf!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(csrf)){await conn.rollback();reply(res,403,{error:'Invalid security token.'});return true;}
    const actual=Buffer.from(hashToken(csrf),'hex'), expected=Buffer.from(actor.csrf_hash,'hex');
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){await conn.rollback();reply(res,403,{error:'Invalid security token.'});return true;}
    const permission=match[2]==='suspend'?'admin.users.suspend':'admin.users.restore';
    const [grants]=await conn.execute("SELECT p.id FROM users u JOIN role_permissions rp ON rp.role_id=u.role_id JOIN permissions p ON p.id=rp.permission_id WHERE u.id=? AND u.status='ACTIVE' AND p.name=? FOR UPDATE",[actor.id,permission]);
    if(!grants.length){await conn.rollback();reply(res,403,{error:'Permission denied.'});return true;}
    const [targets]=await conn.execute('SELECT CAST(u.id AS CHAR) AS id,u.status,r.name AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? FOR UPDATE',[match[1]]);
    if(!targets.length){await conn.rollback();reply(res,404,{error:'User not found.'});return true;}
    const target=targets[0], action=match[2];
    if(action==='suspend' && (target.id===actor.id || target.role==='OWNER')){await conn.rollback();reply(res,403,{error:'This account cannot be suspended.'});return true;}
    const from=action==='suspend'?'ACTIVE':'SUSPENDED',to=action==='suspend'?'SUSPENDED':'ACTIVE';
    if(target.status!==from){await conn.rollback();reply(res,409,{error:'Account status does not permit this action.'});return true;}
    await conn.execute('UPDATE users SET status=? WHERE id=?',[to,target.id]);
    if(action==='suspend') await conn.execute('DELETE FROM user_sessions WHERE user_id=?',[target.id]);
    await conn.execute("INSERT INTO audit_logs (actor_id, action, target_type, target_id, correlation_id) VALUES (?, ?, 'user', ?, ?)",[actor.id,action==='suspend'?'USER_SUSPENDED':'USER_RESTORED',target.id,randomUUID()]);
    await conn.commit();reply(res,200,{status:to});return true;
  } catch {if(conn){try{await conn.rollback();}catch{}}reply(res,503,{error:'Service unavailable.'});return true;}
  finally {if(conn)conn.release();}
}
