// Server-only, read-only adapter. Purchase/cancellation remain disabled until
// transactional persistence and reconciliation are implemented.
const endpoints = {
  balance: { path: '/balance', params: [] },
  services: { path: '/services', params: ['server', 'country_id'] },
  countries: { path: '/countries', params: ['server', 'service_id', 'provider'] },
  offers: { path: '/offers', params: ['server', 'service_id', 'country_id', 'country_code', 'provider'] }
};
export class ZyrexError extends Error {
  constructor(code, status = null) { super(code); this.name = 'ZyrexError'; this.code = code; this.status = status; }
}
export class ZyrexClient {
  constructor({ baseUrl, apiKey, fetchImpl = fetch, timeoutMs = 10000 }) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.replace(/\/$/, '').endsWith('/api/v1')) throw new Error('Invalid Zyrex HTTPS base URL');
    if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) throw new Error('Invalid API key');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Invalid timeout');
    this.base = url.toString().replace(/\/$/, ''); this.key = apiKey; this.fetch = fetchImpl; this.timeoutMs = timeoutMs;
  }
  async read(operation, params = {}) {
    const endpoint = Object.hasOwn(endpoints, operation) ? endpoints[operation] : null;
    if (!endpoint || !params || typeof params !== 'object' || Array.isArray(params)) throw new ZyrexError('INVALID_REQUEST');
    const url = new URL(this.base + endpoint.path);
    for (const [key, value] of Object.entries(params)) {
      if (!endpoint.params.includes(key) || typeof value !== 'string' || value.length < 1 || value.length > 128) throw new ZyrexError('INVALID_REQUEST');
      url.searchParams.set(key, value);
    }
    return this.#request(url, false);
  }
  // Server-side only; responses can contain OTPs. Never log or persist the payload.
  async orderStatus(orderId) { return this.#statusRead('/order/', orderId, false); }
  async requestStatus(reference) { return this.#statusRead('/requests/', reference, true); }
  async #statusRead(prefix, reference, allowPending) {
    if (typeof reference !== 'string' || reference.length < 1 || reference.length > 128 || /[\/\\.\x00-\x1f\x7f]/.test(reference)) throw new ZyrexError('INVALID_REQUEST');
    return this.#request(new URL(this.base + prefix + encodeURIComponent(reference)), allowPending);
  }
  async #request(url, allowPending) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(url, { method: 'GET', headers: { 'X-API-Key': this.key, Accept: 'application/json' }, redirect: 'error', signal: controller.signal });
      if (response.status === 429) throw new ZyrexError('RATE_LIMITED', 429);
      if (!response.ok) throw new ZyrexError('PROVIDER_HTTP_ERROR', response.status);
      // Bound response size before JSON parsing; don't return or log raw errors.
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > 1048576) throw new ZyrexError('INVALID_RESPONSE');
      const reader = response.body?.getReader();
      if (!reader) throw new ZyrexError('INVALID_RESPONSE');
      const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 1048576) { await reader.cancel(); throw new ZyrexError('INVALID_RESPONSE'); }
        chunks.push(value);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8')); } catch { throw new ZyrexError('INVALID_RESPONSE'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ZyrexError('INVALID_RESPONSE');
      if (response.status === 202 && allowPending) {
        if (body.pending !== true || body.retryable !== false) throw new ZyrexError('INVALID_RESPONSE');
        return body;
      }
      if (response.status === 202 || typeof body.success !== 'boolean') throw new ZyrexError('INVALID_RESPONSE');
      if (!body.success) throw new ZyrexError('PROVIDER_REJECTED', response.status);
      return body;
    } catch (error) {
      if (error instanceof ZyrexError) throw error;
      throw new ZyrexError(controller.signal.aborted ? 'TIMEOUT' : 'CONNECTION_ERROR');
    } finally { clearTimeout(timer); }
  }
}
