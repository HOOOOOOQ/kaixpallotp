import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { migrate, readMigrations } from '../src/db/migrate.mjs';

// Explicit opt-in; never drops a database or existing data. Uses an isolated transaction for fixtures.
test('MySQL/MariaDB migration and core constraints', { skip: process.env.PALL_DB_INTEGRATION !== '1' }, async () => {
  const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD || !/^pall_test_[a-z0-9_]+$/.test(DB_NAME || '')) {
    throw new Error('Set DB credentials and a dedicated DB_NAME beginning pall_test_');
  }
  const conn = await mysql.createConnection({ host: DB_HOST, port: Number(process.env.DB_PORT || 3306), user: DB_USER, password: DB_PASSWORD, database: DB_NAME, multipleStatements: true, ...(process.env.DB_TLS === 'true' ? {ssl: {rejectUnauthorized: true}} : {}) });
  try {
    const files = await readMigrations(fileURLToPath(new URL('../db/migrations/', import.meta.url)));
    await migrate(conn, files, DB_NAME);
    assert.deepEqual(await migrate(conn, files, DB_NAME), []);
    await conn.beginTransaction();
    try {
      const [[role]] = await conn.query("SELECT id FROM roles WHERE name = 'CUSTOMER'");
      assert.ok(role);
      const [user] = await conn.execute('INSERT INTO users (email, password_hash, role_id) VALUES (?, ?, ?)', [`${randomUUID()}@example.invalid`, 'test-hash', role.id]);
      const [wallet] = await conn.execute('INSERT INTO wallets (user_id, currency, available_minor) VALUES (?, ?, ?)', [user.insertId, 'IDR', 100]);
      await assert.rejects(conn.execute('INSERT INTO wallets (user_id, currency) VALUES (?, ?)', [user.insertId, 'IDR']));
      await assert.rejects(conn.execute('UPDATE wallets SET available_minor = -1 WHERE id = ?', [wallet.insertId]));
      await assert.rejects(conn.execute('INSERT INTO wallets (user_id, currency) VALUES (?, ?)', [0, 'IDR']));
      const ledgerSql = 'INSERT INTO wallet_ledger (wallet_id, operation_key, entry_type, available_delta_minor, reserved_delta_minor, previous_available_minor, new_available_minor, previous_reserved_minor, new_reserved_minor, reference_type, reference_id, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
      const entry = [wallet.insertId, randomUUID(), 'TEST', -10, 10, 100, 90, 0, 10, 'TEST', 'test', 'test'];
      await conn.execute(ledgerSql, entry);
      await assert.rejects(conn.execute(ledgerSql, entry));
      await assert.rejects(conn.execute(ledgerSql, [wallet.insertId, randomUUID(), 'TEST', -10, 10, 100, 91, 0, 10, 'TEST', 'test', 'test']));
    } finally { await conn.rollback(); }
  } finally { await conn.end(); }
});
