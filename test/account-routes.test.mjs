import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleApi } from '../src/auth/routes.mjs';

test('account endpoints fail closed without DB and reject unauthenticated or cross-origin requests', async () => {
  const db = { async execute() { return [[]]; } };
  const server = http.createServer(async (req,res) => { await handleApi(req,res, req.url === '/api/account/no-db' ? null : db, req.url); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(origin+'/api/account/no-db')).status, 503);
    assert.equal((await fetch(origin+'/api/account/overview')).status, 401);
    assert.equal((await fetch(origin+'/api/account/login', {method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'})).status, 403);
    assert.equal((await fetch(origin+'/api/account/login', {method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'})).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('tickets require a session, reject cross-user access and hide private messages', async () => {
  const { randomToken, hashToken } = await import('../src/auth/security.mjs');
  const token = randomToken(), csrf = randomToken();
  const db = { async execute(sql, params) {
    if (sql.includes('FROM user_sessions')) return [[{session_id:1,id:42,email:'user@example.com',role:'CUSTOMER',csrf_hash:hashToken(csrf)}]];
    if (sql.includes('FROM support_tickets WHERE id=')) return [params[0] === '7' && params[1] === 42 ? [{id:'7',subject:'Help',category:'OTHER',status:'OPEN'}] : []];
    if (sql.includes('FROM support_messages')) { assert.match(sql, /is_private=FALSE/); return [[{id:'1',body:'Public reply'}]]; }
    throw new Error('Unexpected query');
  }};
  const server = http.createServer(async (req,res) => { await handleApi(req,res,db,req.url); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, cookie = `pall_session=${token}`;
  try {
    assert.equal((await fetch(`${origin}/api/account/tickets/7`)).status, 401);
    assert.equal((await fetch(`${origin}/api/account/tickets/8`, {headers:{cookie}})).status, 404);
    const own = await fetch(`${origin}/api/account/tickets/7`, {headers:{cookie}}); assert.deepEqual((await own.json()).messages, [{id:'1',body:'Public reply'}]);
    assert.equal((await fetch(`${origin}/api/account/tickets`, {method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:'{}'})).status, 403);
    assert.equal((await fetch(`${origin}/api/account/tickets`, {method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf},body:'{}'})).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('orders are filtered server-side, paginated and restricted to the current user', async () => {
  const {randomToken} = await import('../src/auth/security.mjs');
  const token = randomToken(), calls=[];
  const db={async execute(sql,params){
    calls.push({sql,params});
    if(sql.includes('FROM user_sessions')) return [[{session_id:1,id:42,email:'u@example.com',role:'CUSTOMER'}]];
    if(sql.startsWith('SELECT COUNT(*)')) return [[{total:1}]];
    if(sql.includes('FROM orders WHERE id=?')) return [params[0]==='7' && params[1]===42 ? [{id:'7',status:'PENDING'}] : []];
    if(sql.includes('FROM orders WHERE')) return [[{id:'7',service_ref:'svc',country_ref:'ID',status:'PENDING',amount:'500',currency:'IDR'}]];
    if(sql.includes('FROM order_events')) return [[{id:'1',from_status:'PROCESSING',to_status:'PENDING'}]];
    throw Error('Unexpected query');
  }};
  const server=http.createServer(async(req,res)=>{await handleApi(req,res,db,new URL(req.url,'http://internal').pathname);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`, headers={cookie:`pall_session=${token}`};
  try {
    assert.equal((await fetch(`${origin}/api/account/orders`)).status,401);
    assert.equal((await fetch(`${origin}/api/account/orders?page=0`,{headers})).status,400);
    assert.equal((await fetch(`${origin}/api/account/orders?status=INVALID`,{headers})).status,400);
    const list=await fetch(`${origin}/api/account/orders?search=%25_!&status=PENDING&page=2`,{headers});
    assert.equal(list.status,200); assert.equal((await list.json()).page,2);
    const query=calls.find(c=>c.sql.startsWith('SELECT COUNT(*)')); assert.deepEqual(query.params,[42,'PENDING','%!%!_!!%','%!%!_!!%','%!%!_!!%']);
    assert.equal((await fetch(`${origin}/api/account/orders/8`,{headers})).status,404);
    const detail=await fetch(`${origin}/api/account/orders/7`,{headers}); assert.equal(detail.status,200); assert.equal((await detail.json()).events.length,1);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('notifications are scoped to session owner and mutations require CSRF',async()=>{
  const {randomToken,hashToken}=await import('../src/auth/security.mjs');const token=randomToken(),csrf=randomToken();const calls=[];
  const pool={async execute(sql,params){calls.push({sql,params});if(sql.includes('FROM user_sessions'))return [[{id:42,session_id:1,csrf_hash:hashToken(csrf)}]];if(sql.includes('FROM notifications WHERE id='))return [params[0]==='7'&&params[1]===42?[{id:7}]:[]];if(sql.includes('FROM notifications WHERE user_id='))return [[{id:'7',title:'New support reply'}]];if(sql.startsWith('UPDATE notifications'))return [{}];throw Error('unexpected query');}};
  const server=http.createServer((req,res)=>handleApi(req,res,pool,new URL(req.url,'http://internal').pathname));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`,headers={cookie:`pall_session=${token}`};
  try{assert.equal((await fetch(`${base}/api/account/notifications`)).status,401);const list=await fetch(`${base}/api/account/notifications`,{headers});assert.equal((await list.json()).items.length,1);
    assert.equal((await fetch(`${base}/api/account/notifications/7/read`,{method:'POST',headers:{...headers,origin:base}})).status,403);
    assert.equal((await fetch(`${base}/api/account/notifications/8/read`,{method:'POST',headers:{...headers,origin:base,'x-csrf-token':csrf}})).status,404);
    assert.equal((await fetch(`${base}/api/account/notifications/7/read`,{method:'POST',headers:{...headers,origin:base,'x-csrf-token':csrf}})).status,200);
    assert.deepEqual(calls.find(c=>c.sql.startsWith('UPDATE notifications')).params,['7',42]);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('transaction history is owner-scoped, validates pagination and escapes search patterns',async()=>{
  const {randomToken}=await import('../src/auth/security.mjs');const token=randomToken(),calls=[];
  const pool={async execute(sql,params){calls.push({sql,params});if(sql.includes('FROM user_sessions'))return [[{id:42,session_id:1}]];if(sql.startsWith('SELECT COUNT(*)'))return [[{total:1}]];if(sql.includes('WHERE l.id=? AND w.user_id=?'))return [params[0]==='7'&&params[1]===42?[{id:'7',currency:'IDR'}]:[]];if(sql.includes('FROM wallet_ledger'))return [[{id:'7',currency:'IDR'}]];throw Error('unexpected query');}};
  const server=http.createServer((req,res)=>handleApi(req,res,pool,new URL(req.url,'http://internal').pathname));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`,headers={cookie:`pall_session=${token}`};
  try{assert.equal((await fetch(`${base}/api/account/transactions`)).status,401);assert.equal((await fetch(`${base}/api/account/transactions?page=0`,{headers})).status,400);
    const list=await fetch(`${base}/api/account/transactions?search=%25_!&page=2`,{headers});assert.equal(list.status,200);assert.equal((await list.json()).page,2);
    assert.deepEqual(calls.find(c=>c.sql.startsWith('SELECT COUNT(*)')).params,[42,'%!%!_!!%','%!%!_!!%']);
    assert.equal((await fetch(`${base}/api/account/transactions/8`,{headers})).status,404);assert.equal((await fetch(`${base}/api/account/transactions/7`,{headers})).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('API key rotation enforces ownership and CSRF and commits revocation, replacement and audit together',async()=>{
  const {randomToken,hashToken}=await import('../src/auth/security.mjs');const token=randomToken(),csrf=randomToken(),calls=[];let owned=true,failInsert=false;
  const conn={async beginTransaction(){calls.push('begin');},async commit(){calls.push('commit');},async rollback(){calls.push('rollback');},release(){calls.push('release');},async execute(sql,params){calls.push({sql,params});if(sql.startsWith('SELECT name,scope_account'))return [owned?[{name:'Example',scope_account:1,scope_balance:0,scope_transactions:1}]:[]];if(sql.startsWith('INSERT INTO api_keys')){if(failInsert)throw Error('insert failed');return [{insertId:123}];}return [{}];}};
  const pool={async getConnection(){return conn;},async execute(sql){if(sql.includes('FROM user_sessions'))return [[{id:42,session_id:1,csrf_hash:hashToken(csrf)}]];throw Error('unexpected');}};
  const server=http.createServer((req,res)=>handleApi(req,res,pool,new URL(req.url,'http://internal').pathname));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,url=`${origin}/api/account/keys/7/rotate`,cookie=`pall_session=${token}`;
  const post=headers=>fetch(url,{method:'POST',headers:{origin,cookie,...headers}});
  try{assert.equal((await post({})).status,403);owned=false;assert.equal((await post({'x-csrf-token':csrf})).status,404);owned=true;failInsert=true;assert.equal((await post({'x-csrf-token':csrf})).status,503);assert.ok(calls.includes('rollback'));
    failInsert=false;calls.length=0;const response=await post({'x-csrf-token':csrf});assert.equal(response.status,201);const result=await response.json();assert.match(result.secret,/^pk_[A-Za-z0-9_-]{43}$/);assert.deepEqual(calls.find(x=>x.sql?.startsWith('SELECT name,scope_account')).params,['7',42]);assert.equal(calls.find(x=>x.sql?.startsWith('INSERT INTO api_keys')).params[2],hashToken(result.secret));assert.ok(calls.some(x=>x.sql?.startsWith('INSERT INTO audit_logs')));assert.ok(calls.includes('commit'));
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('API usage is accessible only to the session owner and never returns key hashes',async()=>{
  const {randomToken}=await import('../src/auth/security.mjs');const token=randomToken(),calls=[];
  const pool={async execute(sql,params){calls.push({sql,params});if(sql.includes('FROM user_sessions'))return [[{id:42,session_id:1}]];if(sql.startsWith('SELECT COUNT(*)'))return [[{total:1,successful:1,denied:0,limited:0,average_ms:3}]];if(sql.includes('FROM api_usage_logs l JOIN api_keys'))return [[{id:'1',key_name:'Work',endpoint:'/api/v1/balance',status_code:200,duration_ms:3}]];throw Error('unexpected query');}};
  const server=http.createServer((req,res)=>handleApi(req,res,pool,new URL(req.url,'http://internal').pathname));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  try {assert.equal((await fetch(`${origin}/api/account/usage`)).status,401);const response=await fetch(`${origin}/api/account/usage`,{headers:{cookie:`pall_session=${token}`}});const body=await response.json();assert.equal(body.summary.successful,1);assert.equal(body.items.length,1);assert.ok(calls.filter(x=>x.sql.includes('api_usage_logs')).every(x=>x.params[0]===42));assert.equal(JSON.stringify(body).includes('token_hash'),false);}
  finally{await new Promise(resolve=>server.close(resolve));}
});
