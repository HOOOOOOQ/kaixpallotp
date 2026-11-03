import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.mjs';
test('public server serves website and honest health information', async () => {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const home = await fetch(url); assert.equal(home.status, 200); const html = await home.text(); assert.match(html, /PALL/); assert.match(html, /aria-controls="main-navigation"/); assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
    const image = await fetch(`${url}/hero-art.webp`); assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/webp');
    const health = await fetch(`${url}/api/health`); const body = await health.json(); assert.equal(body.application, 'available'); assert.equal(body.provider, 'not_checked');
    assert.equal((await fetch(`${url}/developer`)).status, 200);
    assert.equal((await fetch(`${url}/missing`)).status, 404);
    assert.equal((await fetch(`${url}/api/health`, {method:'POST'})).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
