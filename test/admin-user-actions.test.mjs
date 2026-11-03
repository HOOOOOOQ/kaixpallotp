import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {handleAdmin} from '../src/admin/routes.mjs';
import {randomToken,hashToken} from '../src/auth/security.mjs';

test('admin user actions enforce CSRF and permissions and commit status, session revocation and audit atomically',async()=>{
  const token=randomToken(),csrf=randomToken(),calls=[]; let grant=false,targetRole='CUSTOMER',targetStatus='ACTIVE',targetId='9',failAudit=false;
  const conn={async beginTransaction(){calls.push('begin');},async commit(){calls.push('commit');},async rollback(){calls.push('rollback');},release(){calls.push('release');},async execute(sql,params){calls.push({sql,params});
    if(sql.includes('FROM user_sessions'))return [[{id:'4',csrf_hash:hashToken(csrf)}]];
    if(sql.includes('role_permissions'))return [grant?[{id:1}]:[]];
    if(sql.includes('FROM users u JOIN roles'))return [[{id:targetId,status:targetStatus,role:targetRole}]];
    if(sql.startsWith('INSERT INTO audit_logs')&&failAudit)throw Error('audit failed');
    return [{}];
  }};
  const pool={async getConnection(){return conn;}};
  const server=http.createServer((req,res)=>handleAdmin(req,res,pool,new URL(req.url,'http://internal').pathname));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,url=`${origin}/api/admin/users/9/suspend`,cookie=`pall_session=${token}`;
  const post=(headers)=>fetch(url,{method:'POST',headers:{origin,cookie,...headers}});
  try {
    assert.equal((await post({})).status,403);
    assert.equal((await post({'x-csrf-token':csrf})).status,403);
    grant=true;targetRole='OWNER';assert.equal((await post({'x-csrf-token':csrf})).status,403);
    targetRole='CUSTOMER';targetId='4';assert.equal((await post({'x-csrf-token':csrf})).status,403);targetId='9';targetStatus='SUSPENDED';assert.equal((await post({'x-csrf-token':csrf})).status,409);
    targetStatus='ACTIVE';failAudit=true;assert.equal((await post({'x-csrf-token':csrf})).status,503);assert.ok(calls.includes('rollback'));
    calls.length=0;failAudit=false;const response=await post({'x-csrf-token':csrf});assert.equal(response.status,200);assert.equal((await response.json()).status,'SUSPENDED');
    assert.equal(calls.find(x=>x.sql?.includes('role_permissions')).params[1],'admin.users.suspend');
    assert.ok(calls.some(x=>x.sql?.startsWith('DELETE FROM user_sessions')));
    assert.ok(calls.some(x=>x.sql?.startsWith('INSERT INTO audit_logs')));
    assert.deepEqual(calls.slice(-2),['commit','release']);
    assert.equal((await fetch(url,{method:'POST',headers:{origin:'https://attacker.example',cookie,'x-csrf-token':csrf}})).status,403);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
