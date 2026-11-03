import {assertTransition} from '../domain/order-state.mjs';

// Internal primitive, not an authorization or provider-status verifier.
// Caller must establish access and validate provider business evidence first.
export async function transitionOrder(pool, {orderId, expectedStatus, nextStatus, reason}) {
  if (typeof orderId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(orderId) || typeof expectedStatus !== 'string' || typeof nextStatus !== 'string' || typeof reason !== 'string' || !reason.trim() || reason.length > 255) throw new TypeError('Invalid transition request');
  assertTransition(expectedStatus, nextStatus);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.execute('SELECT status FROM orders WHERE id=? FOR UPDATE', [orderId]);
    if (!orders[0]) throw new Error('Order not found');
    if (orders[0].status !== expectedStatus) throw new Error('Order state conflict');
    await conn.execute('UPDATE orders SET status=? WHERE id=?', [nextStatus, orderId]);
    await conn.execute('INSERT INTO order_events (order_id, from_status, to_status, reason) VALUES (?, ?, ?, ?)', [orderId, expectedStatus, nextStatus, reason]);
    await conn.commit(); return {from:expectedStatus, to:nextStatus};
  } catch (error) { try { await conn.rollback(); } catch {} throw error; }
  finally { conn.release(); }
}
