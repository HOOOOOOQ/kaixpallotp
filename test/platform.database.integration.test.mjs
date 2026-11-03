import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import mysql from 'mysql2/promise';
import {migrate,readMigrations} from '../src/db/migrate.mjs';
import {applyLedgerOperation} from '../src/wallet/ledger.mjs';
import {hashToken,randomToken} from '../src/auth/security.mjs';

test('database-backed account, key revocation and concurrent ledger operations', {skip:process.env.PALL_DB_INTEGRATION !== '1'}, async () => {
  const {DB_HOST,DB_USER,DB_PASSWORD,DB_NAME}=process.env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD || !/^pall_test_[a-z0-9_]+$/.test(DB_NAME || '')) throw new Error('Dedicated pall_test_ database and credentials required');
  const config={host:DB_HOST,port:Number(process.env.DB_PORT || 3306),user:DB_USER,password:DB_PASSWORD,database:DB_NAME,multipleStatements:true,timezone:'Z',supportBigNumbers:true,bigNumberStrings:true,...(process.env.DB_TLS==='true'?{ssl:{rejectUnauthorized:true}}:{})};
  const migrationConnection=await mysql.createConnection(config);
  try { await migrate(migrationConnection,await readMigrations(fileURLToPath(new URL('../db/migrations/',import.meta.url))),DB_NAME); } finally {await migrationConnection.end();}
  const pool=mysql.createPool({...config,connectionLimit:5});
  const {createServer,closeDatabase}=await import('../src/server.mjs');
  const server=createServer(); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`, email=`${randomUUID()}@example.invalid`; let userId, testRoleId, targetId;
  try {
    const registration=await fetch(`${origin}/api/account/register`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email,password:'a-strong-test-password'})});
    assert.equal(registration.status,201); const cookie=registration.headers.get('set-cookie').split(';')[0]; const {csrf}=await registration.json();
    const [[user]]=await pool.execute('SELECT CAST(id AS CHAR) AS id FROM users WHERE email=?',[email]); userId=user.id;
    assert.equal((await fetch(`${origin}/api/admin/users`,{headers:{cookie}})).status,403);
    const [roleInsert]=await pool.execute('INSERT INTO roles (name) VALUES (?)',[`TEST_${randomUUID()}`]); testRoleId=String(roleInsert.insertId);
    await pool.execute('INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name=?',[testRoleId,'admin.users.read']);
    await pool.execute('UPDATE users SET role_id=? WHERE id=?',[testRoleId,userId]);
    assert.equal((await fetch(`${origin}/api/admin/users`,{headers:{cookie}})).status,200);
    assert.equal((await fetch(`${origin}/api/admin/orders`,{headers:{cookie}})).status,403);
    await pool.execute('INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name IN (?, ?)',[testRoleId,'admin.users.suspend','admin.users.restore']);
    const [target]=await pool.execute("INSERT INTO users (email,password_hash,role_id) SELECT ?,?,id FROM roles WHERE name='CUSTOMER'", [`${randomUUID()}@example.invalid`,'test-hash']); targetId=String(target.insertId);
    await pool.execute('INSERT INTO user_sessions (user_id,token_hash,csrf_hash,expires_at) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))',[targetId,hashToken(randomToken()),hashToken(randomToken())]);
    const suspend=await fetch(`${origin}/api/admin/users/${targetId}/suspend`,{method:'POST',headers:{origin,cookie,'x-csrf-token':csrf}}); assert.equal(suspend.status,200);
    const [[suspended]]=await pool.execute('SELECT status FROM users WHERE id=?',[targetId]); assert.equal(suspended.status,'SUSPENDED');
    const [[sessions]]=await pool.execute('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id=?',[targetId]); assert.equal(Number(sessions.n),0);
    const restore=await fetch(`${origin}/api/admin/users/${targetId}/restore`,{method:'POST',headers:{origin,cookie,'x-csrf-token':csrf}}); assert.equal(restore.status,200);
    const [[restored]]=await pool.execute('SELECT status FROM users WHERE id=?',[targetId]); assert.equal(restored.status,'ACTIVE');
    await pool.execute('INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name IN (?, ?, ?)',[testRoleId,'admin.support.read','admin.support.reply','admin.support.status']);
    const [ticket]=await pool.execute("INSERT INTO support_tickets (user_id,subject,category) VALUES (?,'Integration support','OTHER')",[targetId]);
    const publicReply={message:'Public test reply',private:false,operationKey:randomUUID().replaceAll('-','')};
    const supportHeaders={origin,cookie,'content-type':'application/json','x-csrf-token':csrf};
    const reply=await fetch(`${origin}/api/admin/support/${ticket.insertId}`,{method:'POST',headers:supportHeaders,body:JSON.stringify(publicReply)}); assert.equal(reply.status,201);
    const replay=await fetch(`${origin}/api/admin/support/${ticket.insertId}`,{method:'POST',headers:supportHeaders,body:JSON.stringify(publicReply)}); assert.equal(replay.status,200);
    const privateReply={message:'Private staff note',private:true,operationKey:randomUUID().replaceAll('-','')};
    assert.equal((await fetch(`${origin}/api/admin/support/${ticket.insertId}`,{method:'POST',headers:supportHeaders,body:JSON.stringify(privateReply)})).status,201);
    const targetToken=randomToken(); await pool.execute('INSERT INTO user_sessions (user_id,token_hash,csrf_hash,expires_at) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))',[targetId,hashToken(targetToken),hashToken(randomToken())]);
    const targetCookie=`pall_session=${targetToken}`;
    const ticketView=await fetch(`${origin}/api/account/tickets/${ticket.insertId}`,{headers:{cookie:targetCookie}});assert.equal(ticketView.status,200);assert.deepEqual((await ticketView.json()).messages.map(x=>x.body),['Public test reply']);
    const notifications=await fetch(`${origin}/api/account/notifications`,{headers:{cookie:targetCookie}});assert.equal(notifications.status,200);assert.equal((await notifications.json()).items.length,1);
    const ticketStatus=await fetch(`${origin}/api/admin/support/${ticket.insertId}/status`,{method:'POST',headers:supportHeaders,body:JSON.stringify({expectedStatus:'WAITING_FOR_CUSTOMER',status:'RESOLVED'})});assert.equal(ticketStatus.status,200);
    const [[statusEvent]]=await pool.execute('SELECT COUNT(*) AS n FROM support_status_events WHERE ticket_id=?',[ticket.insertId]);assert.equal(Number(statusEvent.n),1);



    const keyResponse=await fetch(`${origin}/api/account/keys`,{method:'POST',headers:{origin,cookie,'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({name:'Integration key',scopes:['balance.read']})});
    assert.equal(keyResponse.status,201); const key=await keyResponse.json();
    const [[stored]]=await pool.execute('SELECT token_hash FROM api_keys WHERE id=? AND user_id=?',[key.id,userId]); assert.equal(stored.token_hash,hashToken(key.secret)); assert.notEqual(stored.token_hash,key.secret);
    assert.equal((await fetch(`${origin}/api/v1/balance`,{headers:{authorization:`Bearer ${key.secret}`}})).status,200);
    const usageResponse=await fetch(`${origin}/api/account/usage`,{headers:{cookie}});assert.equal(usageResponse.status,200);const usage=await usageResponse.json();assert.equal(usage.summary.successful,1);assert.equal(usage.items[0].endpoint,'/api/v1/balance');

    const rotation=await fetch(`${origin}/api/account/keys/${key.id}/rotate`,{method:'POST',headers:{origin,cookie,'x-csrf-token':csrf}});assert.equal(rotation.status,201);const replacement=await rotation.json();
    assert.equal((await fetch(`${origin}/api/v1/balance`,{headers:{authorization:`Bearer ${key.secret}`}})).status,401);
    assert.equal((await fetch(`${origin}/api/v1/balance`,{headers:{authorization:`Bearer ${replacement.secret}`}})).status,200);
    assert.equal((await fetch(`${origin}/api/account/keys/${replacement.id}/revoke`,{method:'POST',headers:{origin,cookie,'x-csrf-token':csrf}})).status,200);
    assert.equal((await fetch(`${origin}/api/v1/balance`,{headers:{authorization:`Bearer ${replacement.secret}`}})).status,401);
    const [insertedOrder]=await pool.execute("INSERT INTO orders (user_id, provider, idempotency_key, request_hash, country_ref, service_ref, customer_price_minor, provider_price_minor, currency, status) VALUES (?, 'TEST', ?, ?, 'ID', 'integration-service', 100, 90, 'IDR', 'PENDING')", [userId,randomUUID(),'a'.repeat(64)]);
    await pool.execute("INSERT INTO order_events (order_id, from_status, to_status, reason) VALUES (?, 'PROCESSING', 'PENDING', 'integration fixture')", [insertedOrder.insertId]);
    const history=await fetch(`${origin}/api/account/orders?search=integration-service&status=PENDING`,{headers:{cookie}}); assert.equal(history.status,200); assert.equal((await history.json()).total,1);
    const detail=await fetch(`${origin}/api/account/orders/${insertedOrder.insertId}`,{headers:{cookie}}); assert.equal(detail.status,200); assert.equal((await detail.json()).events.length,1);
    const [[wallet]]=await pool.execute('SELECT CAST(id AS CHAR) AS id FROM wallets WHERE user_id=?',[userId]);
    const base={walletId:wallet.id,currency:'IDR',entryType:'TEST',referenceType:'TEST',referenceId:'integration',description:'Integration fixture'};
    await applyLedgerOperation(pool,{...base,operationKey:'fund',availableDelta:100n,reservedDelta:0n});
    const operation={...base,operationKey:'reserve',availableDelta:-30n,reservedDelta:30n};
    const results=await Promise.all([applyLedgerOperation(pool,operation),applyLedgerOperation(pool,operation)]);
    assert.equal(results.filter(x=>x.replayed).length,1);
    const [[state]]=await pool.execute('SELECT CAST(available_minor AS CHAR) AS available, CAST(reserved_minor AS CHAR) AS reserved FROM wallets WHERE id=?',[wallet.id]);
    assert.deepEqual(state,{available:'70',reserved:'30'});
    const [[ledger]]=await pool.execute('SELECT COUNT(*) AS n FROM wallet_ledger WHERE wallet_id=?',[wallet.id]); assert.equal(Number(ledger.n),2);
    const transactionList=await fetch(`${origin}/api/account/transactions?search=Integration`,{headers:{cookie}});assert.equal(transactionList.status,200);const transactionData=await transactionList.json();assert.equal(transactionData.total,2);
    const transactionDetail=await fetch(`${origin}/api/account/transactions/${transactionData.items[0].id}`,{headers:{cookie}});assert.equal(transactionDetail.status,200);

    await assert.rejects(applyLedgerOperation(pool,{...operation,availableDelta:-40n}),/Idempotency conflict/);
    await assert.rejects(applyLedgerOperation(pool,{...base,operationKey:'overspend',availableDelta:-100n,reservedDelta:0n}),/Insufficient balance/);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    // Remove only the uniquely-created test account and its own fixture records.
    if (targetId) { await pool.execute('DELETE FROM support_status_events WHERE ticket_id IN (SELECT id FROM support_tickets WHERE user_id=?)',[targetId]); await pool.execute('DELETE FROM notifications WHERE user_id=?',[targetId]); await pool.execute('DELETE FROM support_messages WHERE ticket_id IN (SELECT id FROM support_tickets WHERE user_id=?)',[targetId]); await pool.execute('DELETE FROM support_tickets WHERE user_id=?',[targetId]); await pool.execute('DELETE FROM user_sessions WHERE user_id=?',[targetId]); await pool.execute('DELETE FROM users WHERE id=?',[targetId]); }
    if (userId) {
      await pool.execute('DELETE FROM order_events WHERE order_id IN (SELECT id FROM orders WHERE user_id=?)',[userId]);
      await pool.execute('DELETE FROM orders WHERE user_id=?',[userId]);
      await pool.execute('DELETE FROM wallet_ledger WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id=?)',[userId]);
      await pool.execute('DELETE FROM wallets WHERE user_id=?',[userId]);
      await pool.execute('DELETE FROM api_usage_logs WHERE user_id=?',[userId]);
      await pool.execute('DELETE FROM api_keys WHERE user_id=?',[userId]);
      await pool.execute('DELETE FROM user_sessions WHERE user_id=?',[userId]);
      await pool.execute('DELETE FROM audit_logs WHERE actor_id=?',[userId]);
      await pool.execute('DELETE FROM users WHERE id=? AND email=?',[userId,email]);
    }
    if (testRoleId) { await pool.execute('DELETE FROM role_permissions WHERE role_id=?',[testRoleId]); await pool.execute('DELETE FROM roles WHERE id=?',[testRoleId]); }
    await pool.end();
    await closeDatabase();
  }
});
