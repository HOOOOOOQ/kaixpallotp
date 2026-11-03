import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleCustomerApi } from '../src/customer-api/routes.mjs';
import { randomToken, hashToken } from '../src/auth/security.mjs';

test('versioned API authenticates keys, applies scopes and rate limit, and scopes data to the owner', async () => {
  const secret = `pk_${randomToken()}`; let enabled = true, allowed = true, count = 0; const queries = [];
  const conn = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, params) {
      queries.push({sql,params});
      if (sql.includes('FROM api_keys k')) return [enabled && params[0] === hashToken(secret) ? [{id:1,user_id:42,scope_account:1,scope_balance:allowed ? 1 : 0,scope_transactions:0,window_count:count,window_expired:0}] : []];
      if (sql.startsWith('UPDATE api_keys')) { count++; return [{}]; }
      if (sql.startsWith('INSERT INTO api_usage_logs')) return [{}];
      if (sql.includes('FROM wallets')) { assert.equal(params[0],42); return [[{currency:'IDR',available_minor:'120',reserved_minor:'0'}]]; }
      throw new Error('unexpected query');
    }
  };
  const server = http.createServer((req,res) => handleCustomerApi(req,res,{getConnection:async()=>conn},req.url));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/v1/balance`;
  try {
    assert.equal((await fetch(url)).status,401);
    let response = await fetch(url,{headers:{authorization:`Bearer ${secret}`}}); assert.equal(response.status,200); assert.equal((await response.json()).balances[0].available_minor,'120');
    allowed = false; assert.equal((await fetch(url,{headers:{authorization:`Bearer ${secret}`}})).status,403);
    allowed = true; count = 60; assert.equal((await fetch(url,{headers:{authorization:`Bearer ${secret}`}})).status,429);
    enabled = false; assert.equal((await fetch(url,{headers:{authorization:`Bearer ${secret}`}})).status,401);
    const logs=queries.filter(q=>q.sql.startsWith('INSERT INTO api_usage_logs'));
    assert.deepEqual(logs.map(q=>q.params[3]),[200,403,429]);
    assert.equal(JSON.stringify(queries).includes(secret),false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
