import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, validCredentials, randomToken, hashToken, cookieValue, sameOrigin } from '../src/auth/security.mjs';
test('passwords are salted and verified with scrypt', async () => {
  const a = await hashPassword('a sufficiently long password'), b = await hashPassword('a sufficiently long password');
  assert.notEqual(a, b); assert.equal(await verifyPassword('a sufficiently long password', a), true); assert.equal(await verifyPassword('wrong password', a), false); assert.equal(await verifyPassword('password', 'malformed'), false);
});
test('validates input and parses opaque tokens', () => {
  assert.equal(validCredentials('a@example.com', 'short'), false); assert.equal(validCredentials('a@example.com', 'long enough password'), true);
  const token = randomToken(); assert.equal(token.length, 43); assert.equal(hashToken(token).length, 64); assert.equal(cookieValue(`foo=1; pall_session=${token}`, 'pall_session'), token); assert.equal(cookieValue('pall_session=bad', 'pall_session'), null);
});
test('rejects missing or cross-origin requests', () => {
  assert.equal(sameOrigin({headers:{origin:'https://example.com',host:'example.com'}}), true);
  assert.equal(sameOrigin({headers:{origin:'https://evil.example',host:'example.com'}}), false);
  assert.equal(sameOrigin({headers:{host:'example.com'}}), false);
});
