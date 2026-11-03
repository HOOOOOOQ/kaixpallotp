import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const randomToken = () => randomBytes(32).toString('base64url');
export const hashToken = token => createHash('sha256').update(token).digest('hex');
export function validCredentials(email, password) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && typeof password === 'string' && password.length >= 12 && Buffer.byteLength(password) <= 256;
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const parts = typeof encoded === 'string' ? encoded.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '16384' || parts[2] !== '8' || parts[3] !== '1' || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5]) || typeof password !== 'string' || Buffer.byteLength(password) > 256) return false;
  const key = await scrypt(password, parts[4], 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(key, Buffer.from(parts[5], 'hex'));
}
export function sameOrigin(req) {
  try {
    const origin = new URL(req.headers.origin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) return false;
    if (process.env.APP_ORIGIN) return origin.origin === new URL(process.env.APP_ORIGIN).origin;
    if (process.env.NODE_ENV === 'production') return false;
    return origin.host === req.headers.host;
  } catch { return false; }
}
export function cookieValue(header, name) {
  const values = (header || '').split(';').map(x => x.trim().split('='));
  const value = values.find(pair => pair[0] === name)?.[1];
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
