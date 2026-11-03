import { applyWalletDelta } from '../domain/wallet.mjs';

const MAX = 9223372036854775807n;
const idPattern = /^[1-9][0-9]{0,19}$/;
const text = (value, max) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max;

// Internal service only. Do not expose this function directly to customers.
// No provider/payment operation is enabled by this primitive.
export async function applyLedgerOperation(pool, input) {
  const { walletId, operationKey, entryType, availableDelta, reservedDelta, referenceType, referenceId, description, actorId = null, currency } = input || {};
  if (typeof walletId !== 'string' || !idPattern.test(walletId) || (actorId !== null && (typeof actorId !== 'string' || !idPattern.test(actorId))) ||
      !text(operationKey, 128) || !text(entryType, 32) || !text(referenceType, 32) || !text(referenceId, 128) || !text(description, 255) ||
      typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency) ||
      typeof availableDelta !== 'bigint' || typeof reservedDelta !== 'bigint' ||
      availableDelta < -MAX || availableDelta > MAX || reservedDelta < -MAX || reservedDelta > MAX ||
      (availableDelta === 0n && reservedDelta === 0n)) throw new TypeError('Invalid ledger operation');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [wallets] = await conn.execute('SELECT id, currency, CAST(available_minor AS CHAR) AS available_minor, CAST(reserved_minor AS CHAR) AS reserved_minor FROM wallets WHERE id=? FOR UPDATE', [walletId]);
    const wallet = wallets[0];
    if (!wallet || wallet.currency !== currency) throw new Error('Wallet not found or currency mismatch');
    // Row lock serializes both the balance update and idempotency check per wallet.
    const [existing] = await conn.execute('SELECT entry_type, CAST(available_delta_minor AS CHAR) AS available_delta_minor, CAST(reserved_delta_minor AS CHAR) AS reserved_delta_minor, reference_type, reference_id, description, CAST(created_by AS CHAR) AS created_by, CAST(new_available_minor AS CHAR) AS new_available_minor, CAST(new_reserved_minor AS CHAR) AS new_reserved_minor FROM wallet_ledger WHERE wallet_id=? AND operation_key=?', [walletId, operationKey]);
    if (existing.length) {
      const e = existing[0];
      if (e.entry_type !== entryType || BigInt(e.available_delta_minor) !== availableDelta || BigInt(e.reserved_delta_minor) !== reservedDelta || e.reference_type !== referenceType || e.reference_id !== referenceId || e.description !== description || e.created_by !== actorId) throw new Error('Idempotency conflict');
      await conn.commit();
      return { replayed:true, available:e.new_available_minor, reserved:e.new_reserved_minor };
    }
    const before = {available:BigInt(wallet.available_minor), reserved:BigInt(wallet.reserved_minor)};
    const after = applyWalletDelta(before, {available:availableDelta, reserved:reservedDelta});
    await conn.execute('UPDATE wallets SET available_minor=?, reserved_minor=? WHERE id=?', [String(after.available), String(after.reserved), walletId]);
    await conn.execute('INSERT INTO wallet_ledger (wallet_id, operation_key, entry_type, available_delta_minor, reserved_delta_minor, previous_available_minor, new_available_minor, previous_reserved_minor, new_reserved_minor, reference_type, reference_id, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [walletId, operationKey, entryType, String(availableDelta), String(reservedDelta), String(before.available), String(after.available), String(before.reserved), String(after.reserved), referenceType, referenceId, description, actorId]);
    await conn.commit();
    return {replayed:false, available:String(after.available), reserved:String(after.reserved)};
  } catch (error) { try { await conn.rollback(); } catch {} throw error; }
  finally { conn.release(); }
}
