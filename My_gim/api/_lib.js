// Utilidades compartidas de la API (Vercel Functions, sin dependencias).
const crypto = require('crypto');

const REDIS_URL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SECRET = () => process.env.AUTH_SECRET;
const configured = () => !!(REDIS_URL() && REDIS_TOKEN() && SECRET());

async function redis(...cmd) {
  const r = await fetch(REDIS_URL(), { method: 'POST', headers: { Authorization: 'Bearer ' + REDIS_TOKEN() }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error('redis: ' + j.error);
  return j.result;
}

const b64 = b => Buffer.from(b).toString('base64url');
const sign = s => crypto.createHmac('sha256', SECRET()).update(s).digest('base64url');
function makeToken(uid) {
  const p = b64(JSON.stringify({ uid, exp: Date.now() + 90 * 864e5 }));
  return p + '.' + sign(p);
}
function readToken(req) {
  const h = req.headers.authorization || ''; const [p, s] = h.replace(/^Bearer /, '').split('.');
  if (!p || !s) return null;
  const good = Buffer.from(sign(p)), got = Buffer.from(s);
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
  try { const d = JSON.parse(Buffer.from(p, 'base64url')); return d.exp > Date.now() ? d.uid : null; } catch { return null; }
}

const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  new Promise((ok, ko) => crypto.scrypt(pw, salt, 32, (e, k) => e ? ko(e) : ok({ salt, hash: k.toString('hex') })));
async function checkPw(pw, u) {
  const { hash } = await hashPw(pw, u.salt);
  const a = Buffer.from(hash), b = Buffer.from(u.hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
const clip = (s, n) => String(s ?? '').trim().slice(0, n);

async function getUserById(id) { const raw = await redis('GET', 'user:' + id); return raw ? JSON.parse(raw) : null; }
async function getUserByEmail(email) { const id = await redis('GET', 'email:' + email); return id ? getUserById(id) : null; }
const saveUser = u => redis('SET', 'user:' + u.id, JSON.stringify(u));
const publicUser = u => ({ id: u.id, email: u.email, name: u.name, surname: u.surname, avatar: u.avatar || '', prefs: u.prefs || {} });

async function sendMail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw Object.assign(new Error('mail'), { status: 503 });
  const r = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM || 'My Gim <onboarding@resend.dev>', to: [to], subject, html })
  });
  if (!r.ok) throw Object.assign(new Error('mail'), { status: 502 });
}

module.exports = { redis, configured, makeToken, readToken, hashPw, checkPw, normEmail, validEmail, clip, getUserById, getUserByEmail, saveUser, publicUser, sendMail };
