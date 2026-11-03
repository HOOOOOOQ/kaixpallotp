import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, assertTransition } from '../src/domain/order-state.mjs';
import { applyWalletDelta } from '../src/domain/wallet.mjs';

test('orders reject invalid and terminal transitions', () => {
  assert.equal(canTransition('PROCESSING', 'UNKNOWN'), true);
  assert.equal(canTransition('UNKNOWN', 'PENDING'), true);
  assert.equal(canTransition('COMPLETED', 'PENDING'), false);
  assert.equal(canTransition('toString', 'PENDING'), false);
  assert.throws(() => assertTransition('PENDING', 'COMPLETED'));
});
test('wallet reserves and releases exact minor units', () => {
  const held = applyWalletDelta({available: 100n, reserved: 0n}, {available: -30n, reserved: 30n});
  assert.deepEqual(held, {available: 70n, reserved: 30n});
  assert.deepEqual(applyWalletDelta(held, {available: 30n, reserved: -30n}), {available: 100n, reserved: 0n});
});
test('wallet rejects invalid, negative and overflowing balances', () => {
  assert.throws(() => applyWalletDelta({available: 1n, reserved: 0n}, {available: -2n, reserved: 0n}), RangeError);
  assert.throws(() => applyWalletDelta({available: 1, reserved: 0n}, {available: 0n, reserved: 0n}), TypeError);
  assert.throws(() => applyWalletDelta({available: 9223372036854775807n, reserved: 0n}, {available: 1n, reserved: 0n}), RangeError);
});
