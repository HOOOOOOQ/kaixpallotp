import { hashToken } from '../auth/security.mjs';
import { randomUUID } from 'node:crypto';
const scopes = { '/api/v1/account':'scope_account', '/api/v1/balance':'scope_balance', '/api/v1/transactions':'scope_transactions' };
const send = (res,status,data,headers={}) => {res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', ...headers}); res.end(JSON.stringify(data));};
export async function handleCustomerApi(req, res, pool, path) {
  if (!path.startsWith('/api/v1/')) return false;
  if (!pool) {send(res,503,{error:'Service unavailable.'}); return true;}
  const scope = scopes[path];
  if (!scope) {send(res,404,{error:'Not found.'}); return true;}
  if (req.method !== 'GET') {send(res,405,{error:'Method not allowed.'},{Allow:'GET'}); return true;}
  const match = /^Bearer (pk_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
  if (!match) {send(res,401,{error:'Invalid API key.'}); return true;}
  const started=Date.now();
  let conn;
  try {
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [rows] = await conn.execute(`SELECT k.id, k.user_id, k.scope_account, k.scope_balance, k.scope_transactions, k.window_count, k.limit_logged,
      (k.window_started IS NULL OR k.window_started <= DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 MINUTE)) AS window_expired
      FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.token_hash=? AND k.revoked_at IS NULL AND u.status='ACTIVE' FOR UPDATE`, [hashToken(match[1])]);
    const key = rows[0];
    if (!key) {await conn.rollback(); send(res,401,{error:'Invalid API key.'}); return true;}
    const log = async status => conn.execute('INSERT INTO api_usage_logs (api_key_id,user_id,endpoint,status_code,duration_ms,correlation_id) VALUES (?,?,?,?,?,?)', [key.id,key.user_id,path,status,Math.min(4294967295,Math.max(0,Date.now()-started)),randomUUID()]);
    if (!key.window_expired && key.window_count >= 60) {
      // Record at most one rate-limit event per key/window to avoid unbounded logs.
      if (!key.limit_logged) { await log(429); await conn.execute('UPDATE api_keys SET limit_logged=TRUE WHERE id=?', [key.id]); }
      await conn.commit(); send(res,429,{error:'Rate limit exceeded.'},{'Retry-After':'60'}); return true;
    }
    await conn.execute('UPDATE api_keys SET window_started=IF(?, UTC_TIMESTAMP(6), window_started), window_count=IF(?, 1, window_count + 1), limit_logged=IF(?, FALSE, limit_logged), last_used_at=UTC_TIMESTAMP(6) WHERE id=?', [key.window_expired, key.window_expired, key.window_expired, key.id]);
    if (!key[scope]) {await log(403); await conn.commit(); send(res,403,{error:'Insufficient scope.'}); return true;}
    let result;
    if (path === '/api/v1/account') {
      const [data] = await conn.execute('SELECT CAST(id AS CHAR) AS id, email, status FROM users WHERE id=?', [key.user_id]); result = {account:data[0]};
    } else if (path === '/api/v1/balance') {
      const [data] = await conn.execute('SELECT currency, CAST(available_minor AS CHAR) AS available_minor, CAST(reserved_minor AS CHAR) AS reserved_minor FROM wallets WHERE user_id=? ORDER BY currency', [key.user_id]); result = {balances:data};
    } else {
      const [data] = await conn.execute('SELECT CAST(l.id AS CHAR) AS id, l.entry_type, CAST(l.available_delta_minor AS CHAR) AS available_delta_minor, CAST(l.reserved_delta_minor AS CHAR) AS reserved_delta_minor, w.currency, l.description, l.created_at FROM wallet_ledger l JOIN wallets w ON w.id=l.wallet_id WHERE w.user_id=? ORDER BY l.id DESC LIMIT 50', [key.user_id]); result = {transactions:data};
    }
    await log(200); await conn.commit(); send(res,200,result); return true;
  } catch { if (conn) { try { await conn.rollback(); } catch {} } send(res,503,{error:'Service unavailable.'}); return true; }
  finally { if (conn) conn.release(); }
}
