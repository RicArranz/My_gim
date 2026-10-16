// Una sola función para toda la API: /api/<acción> (POST con JSON; las lecturas también POST).
const crypto = require('crypto');
const L = require('./_lib');
const SEEDS = require('./_seed');

const fail = (status, code) => Object.assign(new Error(code), { status });
const MAX_AVATAR = 60000;

async function limit(key, max, secs) {
  const n = await L.redis('INCR', key);
  if (n === 1) await L.redis('EXPIRE', key, secs);
  if (n > max) throw fail(429, 'rate');
}
const authed = async req => {
  const id = L.readToken(req); const u = id && await L.getUserById(id);
  if (!u) throw fail(401, 'auth'); return u;
};
const origin = req => process.env.APP_URL || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}`;

const actions = {
  async ping() { return { ok: true, configured: L.configured() }; },

  async signup(req, b) {
    const email = L.normEmail(b.email), name = L.clip(b.name, 60), surname = L.clip(b.surname, 80), pw = String(b.password || '');
    if (!L.validEmail(email) || !name) throw fail(400, 'fields');
    if (pw.length < 6 || pw.length > 200) throw fail(400, 'short');
    const id = crypto.randomUUID();
    // SET NX reserva el correo de forma atómica (evita cuentas duplicadas)
    if (await L.redis('SET', 'email:' + email, id, 'NX') !== 'OK') throw fail(409, 'exists');
    const { salt, hash } = await L.hashPw(pw);
    const u = { id, email, name, surname, avatar: '', prefs: {}, salt, hash, created: Date.now() };
    await L.saveUser(u);
    const seed = SEEDS[email];                       // datos precargados para esa cuenta concreta
    if (seed && name.toLowerCase() === seed.name) {
      for (const [day, items] of Object.entries(seed.days))
        await L.redis('HSET', 'days:' + id, day, JSON.stringify(items.map(i => ({ id: crypto.randomUUID(), ...i }))));
    }
    return { token: L.makeToken(id), user: L.publicUser(u) };
  },

  async login(req, b) {
    const email = L.normEmail(b.email);
    await limit('rl:login:' + email, 10, 600);
    const u = await L.getUserByEmail(email);
    if (!u || !await L.checkPw(String(b.password || ''), u)) throw fail(401, 'creds');
    return { token: L.makeToken(u.id), user: L.publicUser(u) };
  },

  async me(req) { return { user: L.publicUser(await authed(req)) }; },

  async 'update-profile'(req, b) {
    const u = await authed(req);
    if ('name' in b) { u.name = L.clip(b.name, 60); if (!u.name) throw fail(400, 'fields'); }
    if ('surname' in b) u.surname = L.clip(b.surname, 80);
    if ('prefs' in b && b.prefs && typeof b.prefs === 'object') {
      const p = b.prefs; u.prefs = { lang: L.clip(p.lang, 5), mode: L.clip(p.mode, 6), accent: L.clip(p.accent, 10) };
    }
    if ('avatar' in b) {
      const a = String(b.avatar || ''); if (a && (!a.startsWith('data:image/') || a.length > MAX_AVATAR)) throw fail(400, 'avatar');
      u.avatar = a;
    }
    if (b.email && L.normEmail(b.email) !== u.email) {
      const email = L.normEmail(b.email); if (!L.validEmail(email)) throw fail(400, 'fields');
      if (await L.redis('SET', 'email:' + email, u.id, 'NX') !== 'OK') throw fail(409, 'exists');
      await L.redis('DEL', 'email:' + u.email); u.email = email;
    }
    await L.saveUser(u); return { user: L.publicUser(u) };
  },

  async 'change-password'(req, b) {
    const u = await authed(req); const pw = String(b.password || '');
    if (pw.length < 6 || pw.length > 200) throw fail(400, 'short');
    Object.assign(u, await L.hashPw(pw)); await L.saveUser(u); return { ok: true };
  },

  async forgot(req, b) {
    const email = L.normEmail(b.email);
    if (!L.validEmail(email)) throw fail(400, 'fields');
    await limit('rl:forgot:' + email, 5, 3600);
    const u = await L.getUserByEmail(email);
    if (u) { // respondemos igual exista o no la cuenta (no revelar qué correos están registrados)
      const token = crypto.randomBytes(32).toString('base64url');
      await L.redis('SET', 'reset:' + crypto.createHash('sha256').update(token).digest('hex'), u.id, 'EX', 3600);
      const link = `${origin(req)}/#/reset/${token}`;
      await L.sendMail(email, 'My Gim · Cambiar contraseña',
        `<p>Hola ${u.name.replace(/[<>&]/g, '')},</p><p>Pulsa para elegir una nueva contraseña (válido 1 hora):</p><p><a href="${link}">${link}</a></p><p>Si no lo has pedido tú, ignora este correo.</p>`);
    }
    return { ok: true };
  },

  async reset(req, b) {
    const pw = String(b.password || ''); if (pw.length < 6 || pw.length > 200) throw fail(400, 'short');
    const key = 'reset:' + crypto.createHash('sha256').update(String(b.token || '')).digest('hex');
    const id = await L.redis('GET', key); const u = id && await L.getUserById(id);
    if (!u) throw fail(400, 'token');
    await L.redis('DEL', key); Object.assign(u, await L.hashPw(pw)); await L.saveUser(u);
    return { token: L.makeToken(u.id), user: L.publicUser(u) };
  },

  async days(req) {
    const u = await authed(req); const flat = await L.redis('HGETALL', 'days:' + u.id) || [];
    const days = {}; for (let i = 0; i < flat.length; i += 2) days[flat[i]] = JSON.parse(flat[i + 1]);
    return { days };
  },

  async 'save-day'(req, b) {
    const u = await authed(req); const day = String(b.day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(b.items) || b.items.length > 100) throw fail(400, 'fields');
    const items = b.items.map(i => ({
      id: L.clip(i.id, 60), name: L.clip(i.name, 120), note: L.clip(i.note, 200),
      sets: (Array.isArray(i.sets) ? i.sets : []).slice(0, 60).map(s => ({ weight: Math.min(Math.max(+s.weight || 0, 0), 5000), reps: Math.min(Math.max(Math.round(+s.reps) || 0, 0), 10000) })).filter(s => s.reps > 0)
    })).filter(i => i.name && i.sets.length);
    if (items.length) await L.redis('HSET', 'days:' + u.id, day, JSON.stringify(items)); else await L.redis('HDEL', 'days:' + u.id, day);
    return { ok: true };
  }
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const name = req.query.action;
  try {
    if (!Object.prototype.hasOwnProperty.call(actions, name)) throw fail(404, 'notfound');
    if (name !== 'ping' && !L.configured()) throw fail(503, 'config');
    if (req.method !== 'POST' && name !== 'ping') throw fail(405, 'method');
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    res.status(200).json(await actions[name](req, body));
  } catch (e) {
    const status = e.status || 500; if (!e.status) console.error(e);
    res.status(status).json({ error: e.status ? e.message : 'server' });
  }
};
