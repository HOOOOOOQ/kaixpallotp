import mysql from 'mysql2/promise';
const required = ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) { console.error(`Missing configuration: ${missing.join(', ')}`); process.exitCode = 1; }
else {
  let connection;
  try {
    const port = Number(process.env.DB_PORT || 3306);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
    connection = await mysql.createConnection({host:process.env.DB_HOST,port,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectTimeout:5000,...(process.env.DB_TLS === 'true' ? {ssl:{rejectUnauthorized:true}} : {})});
    await connection.query("SET time_zone = '+00:00'");
    const [[status]] = await connection.query('SELECT VERSION() AS version, @@foreign_key_checks AS foreign_keys, @@session.time_zone AS time_zone');
    if (Number(status.foreign_keys) !== 1 || status.time_zone !== '+00:00') throw new Error('Database session checks failed');
    console.log(`Database reachable; version: ${status.version}; foreign keys: enabled; session timezone: UTC.`);
  } catch { console.error('Database validation failed. Check configuration, network, TLS, permissions and database availability.'); process.exitCode = 1; }
  finally { if (connection) await connection.end(); }
}
