import { createHash, timingSafeEqual } from 'node:crypto';
import { ZyrexClient, ZyrexError } from './zyrex.mjs';

const operations = { services: ['server', 'country_id'], countries: ['server', 'service_id', 'provider'], offers: ['server', 'service_id', 'country_id', 'country_code', 'provider'] };
const digest = value => createHash('sha256').update(value).digest();
const send = (res, status, data) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(data)); };

// Operator-only, read-only test interface. Not a customer authentication system.
export async function zyrexRead(req, res, { env = process.env, fetchImpl = fetch } = {}) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'Method not allowed.' }); }
  const access = env.ZYREX_ACCESS_TOKEN;
  if (typeof access !== 'string' || access.length < 32 || access.length > 256) return send(res, 503, { error: 'Zyrex access is not configured.' });
  const match = /^Bearer ([^\s]{1,256})$/.exec(req.headers.authorization || '');
  if (!match || !timingSafeEqual(digest(match[1]), digest(access))) return send(res, 401, { error: 'Unauthorized.' });
  const url = new URL(req.url, 'http://internal');
  const ops = url.searchParams.getAll('operation');
  const operation = ops[0];
  if (ops.length !== 1 || !Object.hasOwn(operations, operation)) return send(res, 400, { error: 'Invalid operation.' });
  const params = {};
  for (const [key, value] of url.searchParams) {
    if (key === '__p' || key === 'operation') continue;
    if (!operations[operation].includes(key) || Object.hasOwn(params, key) || !value || value.length > 128) return send(res, 400, { error: 'Invalid parameters.' });
    params[key] = value;
  }
  if (params.server && !/^[1-5]$/.test(params.server)) return send(res, 400, { error: 'Invalid server.' });
  if (params.provider && !/^provider_[123]$/.test(params.provider)) return send(res, 400, { error: 'Invalid provider.' });
  if (operation === 'offers' && (!params.service_id || !(params.country_id || params.country_code))) return send(res, 400, { error: 'Service and country are required.' });
  let client;
  try { client = new ZyrexClient({ baseUrl: env.ZYREX_BASE_URL, apiKey: env.ZYREX_API_KEY, fetchImpl }); }
  catch { return send(res, 503, { error: 'Zyrex is not configured.' }); }
  try {
    const result = await client.read(operation, params);
    return send(res, 200, result);
  } catch (error) {
    if (error instanceof ZyrexError && error.code === 'RATE_LIMITED') { res.setHeader('Retry-After', '60'); return send(res, 429, { error: 'Provider rate limit reached.' }); }
    return send(res, 502, { error: 'Zyrex request failed.' });
  }
}
