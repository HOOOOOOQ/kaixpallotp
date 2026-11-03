import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {handleSupport} from '../src/admin/support.mjs';
import {randomToken,hashToken} from '../src/auth/security.mjs';

test('support replies require permission and CSRF, are idempotent, and private notes do not notify',async()=>{
  const token=randomToken(),csrf=randomToken(),calls=[];let grant=false, saved=null, failNotification=false;
  const conn={async beginTransaction(){calls.push('begin');},async commit(){calls.push('commit');},async rollback(){calls.push('rollback');},release(){},async execute(sql,params){calls.push({sql,params});
    if(sql.includes('FROM user_sessions'))return [[{id:'4',csrf_hash:hashToken(csrf)}]];
    if(sql.includes('role_permissions'))return [grant?[{id:'1'}]:[]];
    if(sql.includes('FROM support_tickets WHERE id=?'))return [[{id:'9',user_id:'8',status:'OPEN',subject:'Help'}]];
    if(sql.startsWith('SELECT CAST(author_id'))return [saved?[saved]:[]];
    if(sql.startsWith('INSERT INTO support_messages')){saved={author_id:params[1],body:params[2],is_private:params[3]?1:0};return [{}];}
    if(sql.startsWith('INSERT INTO notifications')&&failNotification)throw Error('notification failure');
    return [{}];
  }};const pool={async getConnection(){return conn;}};
  const server=http.createServer((req,res)=>handleSupport(req,res,pool,new URL(req.url,'http://internal').pathname));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,url=`${origin}/api/admin/support/9`,cookie=`pall_session=${token}`;
  const post=(body,csrfValue=csrf)=>fetch(url,{method:'POST',headers:{origin,cookie,'content-type':'application/json','x-csrf-token':csrfValue},body:JSON.stringify(body)});
  const message={message:'This is a reply',private:true,operationKey:'abcdefgh12345678'};
  try{
    assert.equal((await post(message,'bad')).status,403);assert.equal((await post(message)).status,403);
    grant=true;calls.length=0;assert.equal((await post(message)).status,201);assert.equal(calls.some(x=>x.sql?.startsWith('INSERT INTO notifications')),false);assert.ok(calls.includes('commit'));
    calls.length=0;const replay=await post(message);assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);assert.equal(calls.some(x=>x.sql?.startsWith('INSERT INTO support_messages')),false);
    assert.equal((await post({...message,message:'A different message'})).status,409);
    saved=null;calls.length=0;failNotification=true;assert.equal((await post({...message,private:false})).status,503);assert.ok(calls.includes('rollback'));assert.equal(calls.includes('commit'),false);
    saved=null;calls.length=0;failNotification=false;assert.equal((await post({...message,private:false})).status,201);assert.ok(calls.some(x=>x.sql?.startsWith('INSERT INTO notifications')));assert.ok(calls.some(x=>x.sql?.startsWith('INSERT INTO audit_logs')));assert.ok(calls.includes('commit'));
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('support status transitions enforce permissions, stale checks and atomic audit',async()=>{
  const token=randomToken(),csrf=randomToken(),calls=[];let grant=false,status='OPEN',failAudit=false;
  const conn={async beginTransaction(){calls.push('begin');},async commit(){calls.push('commit');},async rollback(){calls.push('rollback');},release(){},async execute(sql,params){calls.push({sql,params});if(sql.includes('FROM user_sessions'))return [[{id:'4',csrf_hash:hashToken(csrf)}]];if(sql.includes('role_permissions'))return [grant?[{id:1}]:[]];if(sql.includes('FROM support_tickets WHERE id=?'))return [[{id:'9',user_id:'8',status}]];if(sql.startsWith('INSERT INTO audit_logs')&&failAudit)throw Error('audit fail');return [{}];}};
  const server=http.createServer((req,res)=>handleSupport(req,res,{getConnection:async()=>conn},new URL(req.url,'http://internal').pathname));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,url=`${origin}/api/admin/support/9/status`;
  const post=body=>fetch(url,{method:'POST',headers:{origin,cookie:`pall_session=${token}`,'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(body)});
  try{const change={expectedStatus:'OPEN',status:'RESOLVED'};assert.equal((await post(change)).status,403);grant=true;assert.equal((await post({expectedStatus:'CLOSED',status:'OPEN'})).status,400);
    status='IN_PROGRESS';assert.equal((await post(change)).status,409);status='OPEN';calls.length=0;failAudit=true;assert.equal((await post(change)).status,503);assert.ok(calls.includes('rollback'));assert.equal(calls.includes('commit'),false);
    calls.length=0;failAudit=false;assert.equal((await post(change)).status,200);assert.equal(calls.find(x=>x.sql?.includes('role_permissions')).params[1],'admin.support.status');assert.ok(calls.some(x=>x.sql?.startsWith('INSERT INTO support_status_events')));assert.ok(calls.some(x=>x.sql?.startsWith('INSERT INTO notifications')));assert.ok(calls.includes('commit'));
  }finally{await new Promise(resolve=>server.close(resolve));}
});
