// Servidor de pruebas: estáticos + la API real de /api con un Redis y un Resend simulados en memoria.
// Uso: node test/server.js   → http://localhost:8123   (los correos "enviados" quedan en GET /__mails)
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'); const mails = [];
const kv = new Map(), exp = new Map();
const alive = k => { if (exp.has(k) && exp.get(k) < Date.now()) { kv.delete(k); exp.delete(k); } return kv.has(k); };
function cmd([c, k, ...a]) {
  c = c.toUpperCase();
  if (c === 'GET') return alive(k) ? kv.get(k) : null;
  if (c === 'SET') { if (a.includes('NX') && alive(k)) return null; kv.set(k, a[0]); const i = a.indexOf('EX'); if (i > -1) exp.set(k, Date.now() + a[i + 1] * 1000); return 'OK'; }
  if (c === 'DEL') { const had = kv.delete(k); return had ? 1 : 0; }
  if (c === 'INCR') { const n = (alive(k) ? +kv.get(k) : 0) + 1; kv.set(k, String(n)); return n; }
  if (c === 'EXPIRE') { exp.set(k, Date.now() + a[0] * 1000); return 1; }
  if (c === 'HSET') { const h = alive(k) ? kv.get(k) : {}; for (let i = 0; i < a.length; i += 2) h[a[i]] = a[i + 1]; kv.set(k, h); return a.length / 2; }
  if (c === 'HLEN') return Object.keys(alive(k) ? kv.get(k) : {}).length;
  if (c === 'HDEL') { const h = kv.get(k) || {}; a.forEach(f => delete h[f]); return a.length; }
  if (c === 'HGETALL') return Object.entries(alive(k) ? kv.get(k) : {}).flat();
  throw new Error('cmd ' + c);
}
http.createServer((q, s) => { let b = ''; q.on('data', d => b += d); q.on('end', () => {
  s.setHeader('Content-Type', 'application/json');
  if (q.url === '/redis') { try { s.end(JSON.stringify({ result: cmd(JSON.parse(b)) })); } catch (e) { s.end(JSON.stringify({ error: e.message })); } }
  else if (q.url === '/mail') { mails.push(JSON.parse(b)); s.end('{"id":"1"}'); }
  else { s.end(JSON.stringify(mails)); }
}); }).listen(process.env.REDIS_PORT || 8124);
if (!process.env.NO_CONFIG) Object.assign(process.env, { KV_REST_API_URL: `http://localhost:${process.env.REDIS_PORT || 8124}/redis`, KV_REST_API_TOKEN: 't', AUTH_SECRET: 'test-secret', RESEND_API_KEY: 'k', RESEND_API_URL: `http://localhost:${process.env.REDIS_PORT || 8124}/mail` });
const handler = require('../api/[action].js');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    let b = ''; q.on('data', d => b += d); q.on('end', () => {
      q.query = { action: u.pathname.slice(5) }; q.body = b ? JSON.parse(b) : {};
      s.status = c => { s.statusCode = c; return s; }; s.json = o => { s.setHeader('Content-Type', 'application/json'); s.end(JSON.stringify(o)); };
      handler(q, s);
    }); return;
  }
  if (u.pathname === '/__mails') { s.setHeader('Content-Type', 'application/json'); return s.end(JSON.stringify(mails)); }
  const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.statusCode = 404; return s.end(); }
  s.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(s);
}).listen(process.env.PORT || 8123, () => console.log('http://localhost:8123'));
