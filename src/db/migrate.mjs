import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const digest = value => createHash('sha256').update(value).digest('hex');

export async function readMigrations(directory) {
  const names = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  if (!names.length) throw new Error('No migrations found');
  const versions = new Set();
  return Promise.all(names.map(async name => {
    const match = /^(\d{3,})_[a-z0-9_]+\.sql$/.exec(name);
    if (!match || versions.has(match[1])) throw new Error(`Invalid or duplicate migration version: ${name}`);
    versions.add(match[1]);
    const sql = await readFile(join(directory, name), 'utf8');
    if (!sql.trim()) throw new Error(`Empty migration: ${name}`);
    return { name, sql, checksum: digest(sql) };
  }));
}

// MySQL DDL auto-commits: a dirty record is deliberately left on failure.
// Repair requires human inspection, never an automatic replay of partial DDL.
export async function migrate(connection, migrations, database) {
  if (!database) throw new Error('Database name required');
  const lockName = `pall-migrate-${digest(database).slice(0, 40)}`;
  const [lock] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
  if (Number(lock[0]?.acquired) !== 1) throw new Error('Could not acquire migration lock');
  try {
    await connection.query("SET time_zone = '+00:00'");
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      state VARCHAR(16) NOT NULL,
      started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      applied_at DATETIME(6) NULL
    ) ENGINE=InnoDB`);
    const [existing] = await connection.query('SELECT name, checksum, state FROM schema_migrations ORDER BY name');
    const local = new Map(migrations.map(m => [m.name, m]));
    for (const row of existing) {
      if (row.state !== 'applied') throw new Error(`Migration ${row.name} is dirty; inspect and repair manually`);
      const file = local.get(row.name);
      if (!file || file.checksum !== row.checksum) throw new Error(`Migration missing or checksum mismatch: ${row.name}`);
    }
    const applied = new Set(existing.map(row => row.name));
    const lastApplied = existing.at(-1)?.name;
    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;
      if (lastApplied && migration.name < lastApplied) throw new Error(`Out-of-order migration: ${migration.name}`);
      await connection.execute('INSERT INTO schema_migrations (name, checksum, state) VALUES (?, ?, ?)', [migration.name, migration.checksum, 'dirty']);
      await connection.query(migration.sql);
      await connection.execute("UPDATE schema_migrations SET state = 'applied', applied_at = CURRENT_TIMESTAMP(6) WHERE name = ? AND state = 'dirty'", [migration.name]);
    }
    return migrations.filter(m => !applied.has(m.name)).map(m => m.name);
  } finally {
    await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]);
  }
}
