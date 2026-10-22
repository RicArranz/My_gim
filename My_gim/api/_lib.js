// Utilidades compartidas de la API (Vercel Functions, sin dependencias).
const crypto = require('crypto');

const REDIS_URL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SECRET = () => process.env.AUTH_SECRET;
const configured = () => !!(REDIS_URL() && REDIS_TOKEN() && SECRET());
const missingEnv = () => [!REDIS_URL() && 'KV_REST_API_URL', !REDIS_TOKEN() && 'KV_REST_API_TOKEN', !SECRET() && 'AUTH_SECRET'].filter(Boolean); // solo nombres, nunca valores

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

const mailFail = (status, code) => Object.assign(new Error(code), { status });
const mailProvider = () => (process.env.BREVO_API_KEY ? 'brevo' : process.env.RESEND_API_KEY ? 'resend' : null);
const mailConfigured = () => !!mailProvider();
function parseFrom(s) {
  const m = String(s || '').match(/^\s*"?(.*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || 'My Gim', email: m[2].trim() } : { name: 'My Gim', email: String(s || '').trim() };
}
// Envío con el proveedor que haya configurado: Brevo (BREVO_API_KEY + MAIL_FROM verificado) o Resend (RESEND_API_KEY).
async function sendMail(to, subject, html) {
  const p = mailProvider(); if (!p) throw mailFail(503, 'mailconfig');
  let r;
  try {
    if (p === 'brevo') {
      const from = parseFrom(process.env.MAIL_FROM); if (!from.email) throw mailFail(503, 'mailconfig');
      r = await fetch(process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email', {
        method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: from, to: [{ email: to }], subject, htmlContent: html })
      });
    } else {
      r = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.MAIL_FROM || 'My Gim <onboarding@resend.dev>', to: [to], subject, html })
      });
    }
  } catch (e) { if (e.status) throw e; console.error('mail: sin conexión con', p, e.message); throw mailFail(502, 'mail'); }
  if (!r.ok) { let body = ''; try { body = (await r.text()).slice(0, 300); } catch { /* */ } console.error('mail: rechazado por', p, r.status, body); throw mailFail(502, 'mail'); }
}

module.exports = { redis, configured, missingEnv, makeToken, readToken, hashPw, checkPw, normEmail, validEmail, clip, getUserById, getUserByEmail, saveUser, publicUser, sendMail, mailConfigured, mailProvider };
