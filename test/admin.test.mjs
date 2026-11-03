import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {handleAdmin} from '../src/admin/routes.mjs';
import {randomToken,hashToken} from '../src/auth/security.mjs';

test('admin routes deny by default, check database permissions and audit authorized reads',async()=>{
  const token=randomToken(), calls=[]; let permission=false,active=true;
  const pool={async execute(sql,params){calls.push({sql,params});
    if(sql.includes('FROM user_sessions')) return [active && params[0]===hashToken(token)?[{id:42}]:[]];
    if(sql.includes('FROM users u JOIN role_permissions')) return [permission?[{id:1}]:[]];
    if(sql.startsWith('INSERT INTO audit_logs'))return [{}];
    if(sql.startsWith('SELECT COUNT(*)'))return [[{total:1}]];
    if(sql.includes('FROM users u JOIN roles'))return [[{id:'1',email:'test@example.invalid',role:'CUSTOMER',status:'ACTIVE'}]];
    throw new Error('unexpected query');
  }};
  const server=http.createServer((req,res)=>handleAdmin(req,res,pool,new URL(req.url,'http://internal').pathname));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const base=`http://127.0.0.1:${server.address().port}`,headers={cookie:`pall_session=${token}`};
  try {
    assert.equal((await fetch(`${base}/api/admin/users`)).status,401);
    assert.equal((await fetch(`${base}/api/admin/users`,{headers})).status,403);
    assert.equal(calls.some(c=>c.sql.startsWith('INSERT INTO audit_logs')),false);
    permission=true;
    const response=await fetch(`${base}/api/admin/users?search=%25_!`,{headers});assert.equal(response.status,200);assert.equal((await response.json()).items[0].email,'test@example.invalid');
    assert.equal(calls.find(c=>c.sql.includes('role_permissions')).params[1],'admin.users.read');
    assert.ok(calls.some(c=>c.sql.startsWith('INSERT INTO audit_logs')));
    assert.deepEqual(calls.find(c=>c.sql.startsWith('SELECT COUNT(*)')).params,['%!%!_!!%']);
    assert.equal((await fetch(`${base}/api/admin/users?page=0`,{headers})).status,400);
    assert.equal((await fetch(`${base}/api/admin/users`,{method:'POST',headers})).status,405);
    active=false;assert.equal((await fetch(`${base}/api/admin/users`,{headers})).status,401);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
