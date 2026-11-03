import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, readMigrations } from '../src/db/migrate.mjs';

function fakeConnection(initial = [], { failDDL = false, lock = 1 } = {}) {
  const rows = initial.map(x => ({ ...x }));
  const calls = [];
  return { rows, calls,
    async execute(sql, params) {
      calls.push(sql);
      if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: lock }]];
      if (sql.startsWith('INSERT INTO schema_migrations')) rows.push({ name: params[0], checksum: params[1], state: params[2] });
      if (sql.startsWith('UPDATE schema_migrations')) rows.find(r => r.name === params[0]).state = 'applied';
      return [[]];
    },
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('SELECT name')) return [rows.map(x => ({...x})).sort((a,b) => a.name.localeCompare(b.name))];
      if (sql === 'CREATE TEST' && failDDL) throw new Error('DDL failed');
      return [[]];
    }
  };
}
const migration = { name: '001_test.sql', checksum: 'abc', sql: 'CREATE TEST' };

test('applies once, records checksum and releases lock', async () => {
  const db = fakeConnection();
  assert.deepEqual(await migrate(db, [migration], 'test'), ['001_test.sql']);
  assert.equal(db.rows[0].state, 'applied');
  assert.deepEqual(await migrate(db, [migration], 'test'), []);
  assert.equal(db.calls.filter(x => x === 'CREATE TEST').length, 1);
  assert.equal(db.calls.filter(x => x.startsWith('SELECT RELEASE_LOCK')).length, 2);
});
test('dirty migration cannot be automatically replayed', async () => {
  const db = fakeConnection([], { failDDL: true });
  await assert.rejects(migrate(db, [migration], 'test'), /DDL failed/);
  assert.equal(db.rows[0].state, 'dirty');
  await assert.rejects(migrate(db, [migration], 'test'), /dirty/);
  assert.equal(db.calls.filter(x => x === 'CREATE TEST').length, 1);
});
test('checksum changes, missing files and out-of-order files are refused', async () => {
  await assert.rejects(migrate(fakeConnection([{...migration, checksum: 'different', state: 'applied'}]), [migration], 'test'), /checksum/);
  await assert.rejects(migrate(fakeConnection([{...migration, state: 'applied'}]), [], 'test'), /missing/);
  await assert.rejects(migrate(fakeConnection([{name: '002_test.sql', checksum: 'abc', state: 'applied'}]), [migration, {...migration, name: '002_test.sql'}], 'test'), /Out-of-order/);
});
test('lock failure prevents migration', async () => {
  const db = fakeConnection([], { lock: 0 });
  await assert.rejects(migrate(db, [migration], 'test'), /lock/);
  assert.equal(db.calls.length, 1);
});
test('migration files must have unique valid versions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pall-migrations-'));
  try {
    await writeFile(join(dir, '001_one.sql'), 'SELECT 1;');
    assert.equal((await readMigrations(dir))[0].checksum.length, 64);
    await writeFile(join(dir, '001_two.sql'), 'SELECT 2;');
    await assert.rejects(readMigrations(dir), /duplicate/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
