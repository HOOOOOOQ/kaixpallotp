import { randomUUID, timingSafeEqual } from 'node:crypto';
import { randomToken, hashToken, hashPassword, verifyPassword, validCredentials, sameOrigin, cookieValue } from './security.mjs';

const attempts = new Map();
// Local process guard only. A shared limiter is required behind multiple instances.
function limit(key) {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  if (attempts.size > 10000 && !attempts.has(key)) return false;
  const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
  entry.count++; attempts.set(key, entry); return entry.count <= 15;
}
function json(res, status, data, extra = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra }); res.end(JSON.stringify(data)); }
async function body(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new Error('invalid');
  let size = 0, content = '';
  for await (const chunk of req) { size += chunk.length; if (size > 4096) throw new Error('invalid'); content += chunk.toString('utf8'); }
  const value = JSON.parse(content); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('invalid'); return value;
}
function cookie(token, clear = false) {
  return `pall_session=${token}; Path=/; HttpOnly; SameSite=Strict; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}Max-Age=${clear ? 0 : 86400}`;
}
async function session(pool, req) {
  const token = cookieValue(req.headers.cookie, 'pall_session'); if (!token) return null;
  const [rows] = await pool.execute(`SELECT s.id AS session_id, s.csrf_hash, u.id, u.email, u.status, r.name AS role
    FROM user_sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id
    WHERE s.token_hash=? AND s.expires_at > UTC_TIMESTAMP(6) AND u.status='ACTIVE'`, [hashToken(token)]);
  return rows[0] || null;
}
function csrfValid(req, s) {
  const value = req.headers['x-csrf-token'];
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const a = Buffer.from(hashToken(value), 'hex'), b = Buffer.from(s.csrf_hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
async function createSession(connection, userId) {
  const token = randomToken(), csrf = randomToken();
  await connection.execute('INSERT INTO user_sessions (user_id, token_hash, csrf_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))', [userId, hashToken(token), hashToken(csrf)]);
  return { token, csrf };
}
export async function handleApi(req, res, pool, path) {
  if (!path.startsWith('/api/account')) return false;
  if (!pool) { json(res, 503, { error: 'Database is not configured.' }); return true; }
  if (req.method === 'POST' && !sameOrigin(req)) { json(res, 403, {error:'Invalid request origin.'}); return true; }
  try {
    if (req.method === 'POST' && (path === '/api/account/register' || path === '/api/account/login')) {
      if (!limit(req.socket.remoteAddress || 'unknown')) { json(res, 429, {error:'Too many attempts. Try again later.'}); return true; }
      let input; try { input = await body(req); } catch { json(res, 400, {error:'Invalid request.'}); return true; }
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      if (!validCredentials(email, input.password)) { json(res, 400, {error:'Enter a valid email and a password of at least 12 characters.'}); return true; }
      if (path.endsWith('/register')) {
        const passwordHash = await hashPassword(input.password);
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const [role] = await conn.query("SELECT id FROM roles WHERE name='CUSTOMER'");
          if (!role[0]) throw new Error('Missing customer role');
          const [result] = await conn.execute('INSERT INTO users (email, password_hash, role_id) VALUES (?, ?, ?)', [email, passwordHash, role[0].id]);
          await conn.execute("INSERT INTO wallets (user_id, currency) VALUES (?, 'IDR')", [result.insertId]);
          await conn.execute("INSERT INTO audit_logs (actor_id, action, target_type, target_id, correlation_id) VALUES (?, 'ACCOUNT_REGISTERED', 'user', ?, ?)", [result.insertId, String(result.insertId), randomUUID()]);
          const tokens = await createSession(conn, result.insertId); await conn.commit();
          json(res, 201, { csrf: tokens.csrf }, {'Set-Cookie': cookie(tokens.token)});
        } catch (error) { await conn.rollback(); if (error.code === 'ER_DUP_ENTRY') json(res, 409, {error:'Account could not be created. Try signing in.'}); else throw error; }
        finally { conn.release(); }
      } else {
        // Lock the account until the session is created. This prevents a login
        // racing with suspension from creating a session after revocation.
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const [users] = await conn.execute('SELECT id, password_hash, status FROM users WHERE email=? FOR UPDATE', [email]);
          // Perform scrypt even for unknown users to reduce timing-based account enumeration.
          const fallback = 'scrypt$16384$8$1$00000000000000000000000000000000$' + '0'.repeat(128);
          const valid = await verifyPassword(input.password, users[0]?.password_hash || fallback);
          if (!valid || users[0]?.status !== 'ACTIVE') { await conn.rollback(); json(res, 401, {error:'Invalid email or password.'}); return true; }
          const tokens = await createSession(conn, users[0].id);
          await conn.commit(); json(res, 200, {csrf:tokens.csrf}, {'Set-Cookie':cookie(tokens.token)});
        } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
      }
      return true;
    }
    const current = await session(pool, req);
    if (!current) { json(res, 401, {error:'Please sign in.'}); return true; }
    if (req.method === 'GET' && path === '/api/account/me') {
      // Rotate the CSRF token for the authenticated session; secret never leaves session scope.
      const csrf = randomToken(); await pool.execute('UPDATE user_sessions SET csrf_hash=? WHERE id=?', [hashToken(csrf), current.session_id]);
      json(res, 200, {email:current.email, role:current.role, csrf}); return true;
    }
    if (req.method === 'POST' && path === '/api/account/logout') {
      if (!csrfValid(req, current)) { json(res, 403, {error:'Invalid security token. Refresh and try again.'}); return true; }
      await pool.execute('DELETE FROM user_sessions WHERE id=?', [current.session_id]); json(res, 200, {ok:true}, {'Set-Cookie':cookie('', true)}); return true;
    }
    if (req.method === 'GET' && path === '/api/account/usage') {
      const [[summary]]=await pool.execute("SELECT COUNT(*) AS total,COALESCE(SUM(status_code=200),0) AS successful,COALESCE(SUM(status_code=403),0) AS denied,COALESCE(SUM(status_code=429),0) AS limited,COALESCE(ROUND(AVG(duration_ms)),0) AS average_ms FROM api_usage_logs WHERE user_id=? AND created_at>=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 DAY)",[current.id]);
      const [items]=await pool.execute('SELECT CAST(l.id AS CHAR) AS id,k.name AS key_name,l.endpoint,l.status_code,l.duration_ms,l.created_at FROM api_usage_logs l JOIN api_keys k ON k.id=l.api_key_id AND k.user_id=l.user_id WHERE l.user_id=? ORDER BY l.id DESC LIMIT 50',[current.id]);
      json(res,200,{summary:{total:Number(summary.total),successful:Number(summary.successful),denied:Number(summary.denied),limited:Number(summary.limited),average_ms:Number(summary.average_ms)},items});return true;
    }
    if (req.method === 'GET' && path === '/api/account/keys') {
      const [keys] = await pool.execute('SELECT CAST(id AS CHAR) AS id, name, token_prefix, scope_account, scope_balance, scope_transactions, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id=? ORDER BY id DESC LIMIT 100', [current.id]);
      json(res, 200, {keys}); return true;
    }
    if (req.method === 'POST' && path === '/api/account/keys') {
      if (!csrfValid(req, current)) { json(res, 403, {error:'Invalid security token. Refresh and try again.'}); return true; }
      let input; try { input = await body(req); } catch { json(res, 400, {error:'Invalid request.'}); return true; }
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      const scopes = input.scopes;
      const allowed = ['account.read','balance.read','transactions.read'];
      if (name.length < 1 || name.length > 80 || !Array.isArray(scopes) || !scopes.length || scopes.length > allowed.length || new Set(scopes).size !== scopes.length || scopes.some(scope => !allowed.includes(scope))) { json(res, 400, {error:'Choose a name and at least one valid scope.'}); return true; }
      const key = `pk_${randomToken()}`; const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [result] = await conn.execute('INSERT INTO api_keys (user_id, name, token_hash, token_prefix, scope_account, scope_balance, scope_transactions) VALUES (?, ?, ?, ?, ?, ?, ?)', [current.id, name, hashToken(key), key.slice(0,11), scopes.includes('account.read'), scopes.includes('balance.read'), scopes.includes('transactions.read')]);
        await conn.execute("INSERT INTO audit_logs (actor_id, action, target_type, target_id, correlation_id) VALUES (?, 'API_KEY_CREATED', 'api_key', ?, ?)", [current.id, String(result.insertId), randomUUID()]);
        await conn.commit(); json(res, 201, {id:String(result.insertId), secret:key});
      } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
      return true;
    }
    const rotateMatch = /^\/api\/account\/keys\/([1-9][0-9]{0,19})\/rotate$/.exec(path);
    if (req.method === 'POST' && rotateMatch) {
      if (!csrfValid(req,current)) {json(res,403,{error:'Invalid security token. Refresh and try again.'});return true;}
      const conn=await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [keys]=await conn.execute('SELECT name,scope_account,scope_balance,scope_transactions FROM api_keys WHERE id=? AND user_id=? AND revoked_at IS NULL FOR UPDATE',[rotateMatch[1],current.id]);
        if(!keys.length){await conn.rollback();json(res,404,{error:'Active key not found.'});return true;}
        const key=keys[0],secret=`pk_${randomToken()}`;
        await conn.execute('UPDATE api_keys SET revoked_at=UTC_TIMESTAMP(6) WHERE id=? AND user_id=?',[rotateMatch[1],current.id]);
        const [result]=await conn.execute('INSERT INTO api_keys (user_id,name,token_hash,token_prefix,scope_account,scope_balance,scope_transactions) VALUES (?,?,?,?,?,?,?)',[current.id,key.name,hashToken(secret),secret.slice(0,11),key.scope_account,key.scope_balance,key.scope_transactions]);
        await conn.execute("INSERT INTO audit_logs (actor_id,action,target_type,target_id,correlation_id) VALUES (?,'API_KEY_ROTATED','api_key',?,?)",[current.id,rotateMatch[1],randomUUID()]);
        await conn.commit();json(res,201,{id:String(result.insertId),secret});
      } catch(error){await conn.rollback();throw error;} finally{conn.release();}
      return true;
    }
    const keyMatch = /^\/api\/account\/keys\/([1-9][0-9]{0,19})\/revoke$/.exec(path);
    if (req.method === 'POST' && keyMatch) {
      if (!csrfValid(req, current)) { json(res, 403, {error:'Invalid security token. Refresh and try again.'}); return true; }
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [result] = await conn.execute('UPDATE api_keys SET revoked_at=UTC_TIMESTAMP(6) WHERE id=? AND user_id=? AND revoked_at IS NULL', [keyMatch[1], current.id]);
        if (!result.affectedRows) { await conn.rollback(); json(res, 404, {error:'Active key not found.'}); return true; }
        await conn.execute("INSERT INTO audit_logs (actor_id, action, target_type, target_id, correlation_id) VALUES (?, 'API_KEY_REVOKED', 'api_key', ?, ?)", [current.id, keyMatch[1], randomUUID()]);
        await conn.commit(); json(res, 200, {ok:true});
      } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
      return true;
    }
    if (req.method === 'GET' && path === '/api/account/notifications') {
      const [items] = await pool.execute('SELECT CAST(id AS CHAR) AS id,category,title,reference_type,reference_id,created_at,read_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50', [current.id]);
      json(res,200,{items});return true;
    }
    const notificationMatch = /^\/api\/account\/notifications\/([1-9][0-9]{0,19})\/read$/.exec(path);
    if (req.method === 'POST' && notificationMatch) {
      if (!csrfValid(req,current)) {json(res,403,{error:'Invalid security token. Refresh and try again.'});return true;}
      const [items]=await pool.execute('SELECT id FROM notifications WHERE id=? AND user_id=?',[notificationMatch[1],current.id]);
      if (!items.length) {json(res,404,{error:'Notification not found.'});return true;}
      await pool.execute('UPDATE notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP(6)) WHERE id=? AND user_id=?',[notificationMatch[1],current.id]);
      json(res,200,{ok:true});return true;
    }
    if (req.method === 'GET' && path === '/api/account/tickets') {
      const [tickets] = await pool.execute('SELECT CAST(id AS CHAR) AS id, subject, category, status, created_at, updated_at FROM support_tickets WHERE user_id=? ORDER BY id DESC LIMIT 50', [current.id]);
      json(res, 200, {tickets}); return true;
    }
    if (req.method === 'POST' && path === '/api/account/tickets') {
      if (!csrfValid(req, current)) { json(res, 403, {error:'Invalid security token. Refresh and try again.'}); return true; }
      let input; try { input = await body(req); } catch { json(res, 400, {error:'Invalid request.'}); return true; }
      const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
      const message = typeof input.message === 'string' ? input.message.trim() : '';
      if (subject.length < 3 || subject.length > 160 || message.length < 5 || message.length > 3000 || !['ACCOUNT','ORDER','PAYMENT','TECHNICAL','OTHER'].includes(input.category)) { json(res, 400, {error:'Check the subject, category, and message.'}); return true; }
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [ticket] = await conn.execute('INSERT INTO support_tickets (user_id, subject, category) VALUES (?, ?, ?)', [current.id, subject, input.category]);
        await conn.execute('INSERT INTO support_messages (ticket_id, author_id, body) VALUES (?, ?, ?)', [ticket.insertId, current.id, message]);
        await conn.commit(); json(res, 201, {id:String(ticket.insertId)});
      } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
      return true;
    }
    const ticketMatch = /^\/api\/account\/tickets\/([1-9][0-9]{0,19})$/.exec(path);
    if (ticketMatch && req.method === 'GET') {
      const [tickets] = await pool.execute('SELECT CAST(id AS CHAR) AS id, subject, category, status, created_at FROM support_tickets WHERE id=? AND user_id=?', [ticketMatch[1], current.id]);
      if (!tickets.length) { json(res, 404, {error:'Ticket not found.'}); return true; }
      const [messages] = await pool.execute('SELECT CAST(id AS CHAR) AS id, body, created_at FROM support_messages WHERE ticket_id=? AND is_private=FALSE ORDER BY id ASC LIMIT 100', [ticketMatch[1]]);
      json(res, 200, {ticket:tickets[0], messages}); return true;
    }
    if (ticketMatch && req.method === 'POST') {
      if (!csrfValid(req, current)) { json(res, 403, {error:'Invalid security token. Refresh and try again.'}); return true; }
      let input; try { input = await body(req); } catch { json(res, 400, {error:'Invalid request.'}); return true; }
      const message = typeof input.message === 'string' ? input.message.trim() : '';
      if (message.length < 5 || message.length > 3000) { json(res, 400, {error:'Message must be between 5 and 3000 characters.'}); return true; }
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [tickets] = await conn.execute('SELECT status FROM support_tickets WHERE id=? AND user_id=? FOR UPDATE', [ticketMatch[1], current.id]);
        if (!tickets.length) { await conn.rollback(); json(res, 404, {error:'Ticket not found.'}); return true; }
        if (['RESOLVED','CLOSED'].includes(tickets[0].status)) { await conn.rollback(); json(res, 409, {error:'This ticket is closed. Please create a new ticket.'}); return true; }
        await conn.execute('INSERT INTO support_messages (ticket_id, author_id, body) VALUES (?, ?, ?)', [ticketMatch[1], current.id, message]);
        await conn.execute("UPDATE support_tickets SET status=CASE WHEN status='WAITING_FOR_CUSTOMER' THEN 'IN_PROGRESS' ELSE status END, updated_at=UTC_TIMESTAMP(6) WHERE id=?", [ticketMatch[1]]);
        await conn.commit(); json(res, 201, {ok:true});
      } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
      return true;
    }
    if (req.method === 'GET' && path === '/api/account/orders') {
      const params = new URL(req.url, 'http://internal').searchParams;
      const pageText = params.get('page') || '1';
      const search = (params.get('search') || '').trim();
      const status = params.get('status') || '';
      const statuses = ['CREATED','VALIDATING','PROCESSING','PENDING','OTP_RECEIVED','COMPLETED','FAILED','EXPIRED','CANCELLATION_REQUESTED','CANCELLED','UNKNOWN'];
      if (!/^[1-9][0-9]{0,4}$/.test(pageText) || search.length > 100 || (status && !statuses.includes(status))) { json(res,400,{error:'Invalid order filter.'}); return true; }
      const page = Number(pageText), pageSize = 20;
      const conditions = ['user_id=?'], values = [current.id];
      if (status) { conditions.push('status=?'); values.push(status); }
      // Treat search as literal text, not SQL LIKE wildcards.
      if (search) { conditions.push("(service_ref LIKE ? ESCAPE '!' OR country_ref LIKE ? ESCAPE '!' OR CAST(id AS CHAR) LIKE ? ESCAPE '!')"); const term = `%${search.replace(/[!%_]/g, c => '!'+c)}%`; values.push(term,term,term); }
      const where = conditions.join(' AND ');
      const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM orders WHERE ${where}`, values);
      const [orders] = await pool.execute(`SELECT CAST(id AS CHAR) AS id, service_ref, country_ref, status, CAST(customer_price_minor AS CHAR) AS amount, currency, created_at FROM orders WHERE ${where} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`, values);
      json(res,200,{orders,total:Number(count.total),page,pageSize}); return true;
    }
    const orderMatch = /^\/api\/account\/orders\/([1-9][0-9]{0,19})$/.exec(path);
    if (req.method === 'GET' && orderMatch) {
      const [orders] = await pool.execute('SELECT CAST(id AS CHAR) AS id, service_ref, country_ref, status, CAST(customer_price_minor AS CHAR) AS amount, currency, created_at, updated_at, expires_at FROM orders WHERE id=? AND user_id=?', [orderMatch[1],current.id]);
      if (!orders.length) { json(res,404,{error:'Order not found.'}); return true; }
      const [events] = await pool.execute('SELECT CAST(id AS CHAR) AS id, from_status, to_status, created_at FROM order_events WHERE order_id=? ORDER BY id ASC LIMIT 100', [orderMatch[1]]);
      json(res,200,{order:orders[0],events}); return true;
    }
    if (req.method === 'GET' && path === '/api/account/transactions') {
      const params=new URL(req.url,'http://internal').searchParams,pageText=params.get('page')||'1',search=(params.get('search')||'').trim();
      if(!/^[1-9][0-9]{0,4}$/.test(pageText)||search.length>100){json(res,400,{error:'Invalid transaction filter.'});return true;}
      const page=Number(pageText),offset=(page-1)*20,term=`%${search.replace(/[!%_]/g,c=>'!'+c)}%`;
      const [[count]]=await pool.execute("SELECT COUNT(*) AS total FROM wallet_ledger l JOIN wallets w ON w.id=l.wallet_id WHERE w.user_id=? AND (l.entry_type LIKE ? ESCAPE '!' OR l.description LIKE ? ESCAPE '!')",[current.id,term,term]);
      const [items]=await pool.execute(`SELECT CAST(l.id AS CHAR) AS id,l.entry_type,CAST(l.available_delta_minor AS CHAR) AS available_delta,CAST(l.reserved_delta_minor AS CHAR) AS reserved_delta,w.currency,l.description,l.created_at FROM wallet_ledger l JOIN wallets w ON w.id=l.wallet_id WHERE w.user_id=? AND (l.entry_type LIKE ? ESCAPE '!' OR l.description LIKE ? ESCAPE '!') ORDER BY l.id DESC LIMIT 20 OFFSET ${offset}`,[current.id,term,term]);
      json(res,200,{items,total:Number(count.total),page,pageSize:20});return true;
    }
    const transactionMatch=/^\/api\/account\/transactions\/([1-9][0-9]{0,19})$/.exec(path);
    if(req.method==='GET'&&transactionMatch){
      const [items]=await pool.execute('SELECT CAST(l.id AS CHAR) AS id,l.entry_type,CAST(l.available_delta_minor AS CHAR) AS available_delta,CAST(l.reserved_delta_minor AS CHAR) AS reserved_delta,CAST(l.previous_available_minor AS CHAR) AS previous_available,CAST(l.new_available_minor AS CHAR) AS new_available,CAST(l.previous_reserved_minor AS CHAR) AS previous_reserved,CAST(l.new_reserved_minor AS CHAR) AS new_reserved,l.reference_type,l.reference_id,l.description,l.created_at,w.currency FROM wallet_ledger l JOIN wallets w ON w.id=l.wallet_id WHERE l.id=? AND w.user_id=?',[transactionMatch[1],current.id]);
      if(!items.length){json(res,404,{error:'Transaction not found.'});return true;}
      json(res,200,{transaction:items[0]});return true;
    }
    if (req.method === 'GET' && path === '/api/account/overview') {
      const [wallets] = await pool.execute('SELECT currency, CAST(available_minor AS CHAR) AS available, CAST(reserved_minor AS CHAR) AS reserved FROM wallets WHERE user_id=?', [current.id]);
      const [counts] = await pool.execute("SELECT COUNT(*) AS total, SUM(status='COMPLETED') AS completed, SUM(status IN ('CREATED','VALIDATING','PROCESSING','PENDING','UNKNOWN','CANCELLATION_REQUESTED')) AS pending FROM orders WHERE user_id=?", [current.id]);
      const [orders] = await pool.execute('SELECT CAST(id AS CHAR) AS id, service_ref, country_ref, status, CAST(customer_price_minor AS CHAR) AS amount, currency, created_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 10', [current.id]);
      const [ledger] = await pool.execute('SELECT CAST(l.id AS CHAR) AS id, l.entry_type, CAST(l.available_delta_minor AS CHAR) AS amount, w.currency, l.description, l.created_at FROM wallet_ledger l JOIN wallets w ON w.id=l.wallet_id WHERE w.user_id=? ORDER BY l.id DESC LIMIT 10', [current.id]);
      json(res, 200, {wallet:wallets[0] || null, counts:counts[0], orders, ledger}); return true;
    }
    json(res, 404, {error:'Not found.'}); return true;
  } catch { json(res, 503, {error:'Service unavailable. Please try again later.'}); return true; }
}
