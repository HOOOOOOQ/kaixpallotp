import { randomUUID } from 'node:crypto';
import { cookieValue, hashToken } from '../auth/security.mjs';
import { handleUserAction } from './user-actions.mjs';
import { handleSupport } from './support.mjs';

const definitions = {
  '/api/admin/overview': { permission:'admin.overview.read' },
  '/api/admin/users': { permission:'admin.users.read' },
  '/api/admin/orders': { permission:'admin.orders.read' },
  '/api/admin/audit': { permission:'admin.audit.read' }
};
function json(res,status,data) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
export async function handleAdmin(req,res,pool,path) {
  if (!path.startsWith('/api/admin/')) return false;
  if (await handleUserAction(req,res,pool,path)) return true;
  if (await handleSupport(req,res,pool,path)) return true;
  const definition = Object.hasOwn(definitions,path) ? definitions[path] : null;
  if (!definition) {json(res,404,{error:'Not found.'});return true;}
  if (req.method !== 'GET') {json(res,405,{error:'Method not allowed.'});return true;}
  if (!pool) {json(res,503,{error:'Service unavailable.'});return true;}
  const token = cookieValue(req.headers.cookie,'pall_session');
  if (!token) {json(res,401,{error:'Please sign in.'});return true;}
  try {
    // User, role and permission are resolved from the database on every request.
    const [users] = await pool.execute("SELECT u.id FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(6) AND u.status='ACTIVE'",[hashToken(token)]);
    if (!users.length) {json(res,401,{error:'Please sign in.'});return true;}
    const userId=users[0].id;
    const [permissions] = await pool.execute('SELECT p.id FROM users u JOIN role_permissions rp ON rp.role_id=u.role_id JOIN permissions p ON p.id=rp.permission_id WHERE u.id=? AND u.status=\'ACTIVE\' AND p.name=?',[userId,definition.permission]);
    if (!permissions.length) {json(res,403,{error:'Permission denied.'});return true;}
    const params=new URL(req.url,'http://internal').searchParams;
    const pageText=params.get('page') || '1'; const search=(params.get('search') || '').trim();
    if (!/^[1-9][0-9]{0,4}$/.test(pageText) || search.length>100) {json(res,400,{error:'Invalid filter.'});return true;}
    const page=Number(pageText), offset=(page-1)*20;
    // Log access without including search terms, credentials or personal data.
    await pool.execute("INSERT INTO audit_logs (actor_id, action, target_type, target_id, correlation_id) VALUES (?, 'ADMIN_VIEW', 'admin_view', ?, ?)",[userId,definition.permission,randomUUID()]);
    if(path==='/api/admin/overview') {
      const [[usersCount]]=await pool.query('SELECT COUNT(*) AS total FROM users');
      const [[orders]]=await pool.query("SELECT COUNT(*) AS total, COALESCE(SUM(status='COMPLETED'),0) AS completed, COALESCE(SUM(status IN ('CREATED','VALIDATING','PROCESSING','PENDING','UNKNOWN','CANCELLATION_REQUESTED')),0) AS pending, COALESCE(SUM(status='FAILED'),0) AS failed FROM orders");
      json(res,200,{users:Number(usersCount.total),orders:{total:Number(orders.total),completed:Number(orders.completed),pending:Number(orders.pending),failed:Number(orders.failed)}});return true;
    }
    const term=`%${search.replace(/[!%_]/g,c=>'!'+c)}%`;
    if(path==='/api/admin/users') {
      const [[count]]=await pool.execute("SELECT COUNT(*) AS total FROM users WHERE email LIKE ? ESCAPE '!'",[term]);
      const [items]=await pool.execute(`SELECT CAST(u.id AS CHAR) AS id,u.email,u.status,r.name AS role,u.created_at FROM users u JOIN roles r ON r.id=u.role_id WHERE u.email LIKE ? ESCAPE '!' ORDER BY u.id DESC LIMIT 20 OFFSET ${offset}`,[term]);
      json(res,200,{items,total:Number(count.total),page,pageSize:20});return true;
    }
    if(path==='/api/admin/orders') {
      const [[count]]=await pool.execute("SELECT COUNT(*) AS total FROM orders WHERE service_ref LIKE ? ESCAPE '!' OR country_ref LIKE ? ESCAPE '!' OR CAST(id AS CHAR) LIKE ? ESCAPE '!'",[term,term,term]);
      const [items]=await pool.execute(`SELECT CAST(id AS CHAR) AS id,CAST(user_id AS CHAR) AS user_id,service_ref,country_ref,status,CAST(customer_price_minor AS CHAR) AS amount,currency,created_at FROM orders WHERE service_ref LIKE ? ESCAPE '!' OR country_ref LIKE ? ESCAPE '!' OR CAST(id AS CHAR) LIKE ? ESCAPE '!' ORDER BY id DESC LIMIT 20 OFFSET ${offset}`,[term,term,term]);
      json(res,200,{items,total:Number(count.total),page,pageSize:20});return true;
    }
    const [[count]]=await pool.execute("SELECT COUNT(*) AS total FROM audit_logs WHERE action LIKE ? ESCAPE '!'",[term]);
    const [items]=await pool.execute(`SELECT CAST(id AS CHAR) AS id,CAST(actor_id AS CHAR) AS actor_id,action,target_type,target_id,created_at FROM audit_logs WHERE action LIKE ? ESCAPE '!' ORDER BY id DESC LIMIT 20 OFFSET ${offset}`,[term]);
    json(res,200,{items,total:Number(count.total),page,pageSize:20});return true;
  } catch {json(res,503,{error:'Service unavailable.'});return true;}
}
