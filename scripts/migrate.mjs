import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { migrate, readMigrations } from '../src/db/migrate.mjs';

const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) {
  console.error(`Missing required configuration: ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  let connection;
  try {
    const port = Number(process.env.DB_PORT || '3306');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid DB_PORT');
    const migrations = await readMigrations(fileURLToPath(new URL('../db/migrations/', import.meta.url)));
    connection = await mysql.createConnection({
      host: process.env.DB_HOST, port, user: process.env.DB_USER,
      password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
      multipleStatements: true, connectTimeout: 10000,
      ...(process.env.DB_TLS === 'true' ? { ssl: { rejectUnauthorized: true } } : {})
    });
    const applied = await migrate(connection, migrations, process.env.DB_NAME);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
  } catch (error) {
    // Avoid printing driver errors: they can contain SQL or connection details.
    console.error('Migration failed. Inspect migration state and database connectivity before retrying.');
    if (error.message.startsWith('Migration ') || error.message.startsWith('Out-of-order ') || error.message.startsWith('Invalid DB_PORT')) console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (connection) await connection.end();
  }
}
