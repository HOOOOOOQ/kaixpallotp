import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { handleApi } from './auth/routes.mjs';
import { handleCustomerApi } from './customer-api/routes.mjs';
import { handleAdmin } from './admin/routes.mjs';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/hero-art.webp': ['hero-art.webp', 'image/webp'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/account': ['account.html', 'text/html; charset=utf-8'], '/dashboard': ['dashboard.html', 'text/html; charset=utf-8'], '/workspace.css': ['workspace.css', 'text/css; charset=utf-8'], '/account.js': ['account.js', 'text/javascript; charset=utf-8'], '/dashboard.js': ['dashboard.js', 'text/javascript; charset=utf-8'], '/admin': ['admin.html', 'text/html; charset=utf-8'], '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'], '/developer': ['developer.html', 'text/html; charset=utf-8'], '/developer.js': ['developer.js', 'text/javascript; charset=utf-8'] };
let pool;
if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME) {
  pool = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectTimeout: 3000, connectionLimit: 5, queueLimit: 20, timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true, ...(process.env.DB_TLS === 'true' ? {ssl: {rejectUnauthorized: true}} : {}) });
}
const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'", 'Cache-Control': 'no-store' };
export async function closeDatabase() { if (pool) await pool.end(); }
export function createServer() {
  return http.createServer(async (req, res) => {
    Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
    const path = new URL(req.url, 'http://internal').pathname;
    if (await handleAdmin(req, res, pool, path)) return;
    if (await handleApi(req, res, pool, path)) return;
    if (await handleCustomerApi(req, res, pool, path)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    if (path === '/api/health') {
      let database = 'not_configured';
      if (pool) { try { await pool.query('SELECT 1'); database = 'available'; } catch { database = 'unavailable'; } }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ application: 'available', database, provider: 'not_checked' }));
    }
    const entry = files[path];
    if (!entry) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    try { const content = await readFile(root + entry[0]); res.writeHead(200, { 'Content-Type': entry[1] }); res.end(req.method === 'HEAD' ? undefined : content); }
    catch { res.writeHead(500); res.end('Server error'); }
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, '0.0.0.0', () => console.log(`PALL × KAII listening on ${port}`));
}
