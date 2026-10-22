// Capa de datos: API propia en Vercel (/api, Redis) si está configurada; si no, modo local (localStorage).
export let isRemote = false;
export let issue = null; // fallo del servidor en un dominio real: {kind:'unconfigured', missing:[...]} | {kind:'http', status} (nunca se cae en silencio a modo local)
const J = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const W = (k, v) => localStorage.setItem(k, JSON.stringify(v));
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now() + Math.random().toString(16).slice(2));

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mygim:' + s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const shape = u => ({ id: u.id, email: u.email, name: u.name || '', surname: u.surname || '', prefs: u.prefs || {}, avatar: u.avatar || '' });

/* ---------- API remota ---------- */
async function api(action, body, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  const tk = localStorage.getItem('mg_token'); if (auth && tk) headers.Authorization = 'Bearer ' + tk;
  const ms = { ping: 5000, me: 8000, 'import-days': 40000 }[action] || 15000, ctl = new AbortController();
  let timer;
  const r = await Promise.race([ // el temporizador manda aunque el navegador no llegue a abortar la petición
    fetch('/api/' + action, { method: 'POST', headers, body: JSON.stringify(body || {}), signal: ctl.signal }),
    new Promise((_, ko) => { timer = setTimeout(() => { ctl.abort(); ko(new TypeError('timeout')); }, ms); })
  ]).finally(() => clearTimeout(timer));
  let j = {}; try { j = await r.json(); } catch { /* respuesta no JSON */ }
  if (!r.ok) throw Object.assign(new Error(j.error || 'server'), { status: r.status, data: j });
  return j;
}
const startSession = r => { localStorage.setItem('mg_token', r.token); W('mg_user_cache', r.user); };

let recoveryCb = null, resetToken = null;
export const onRecovery = cb => { recoveryCb = cb; if (resetToken) cb(); };

const isLocalHost = () => /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || location.protocol === 'file:';

export async function init() {
  issue = null;
  try {
    const p = await api('ping', {}, false);
    isRemote = p.configured === true;
    localStorage.setItem('mg_remote', isRemote ? '1' : '0');
    if (!isRemote && !isLocalHost()) issue = { kind: 'unconfigured', missing: p.missing || [] };
  } catch (e) {
    if (e.status) {
      // El servidor respondió con un error. En localhost = sitio estático sin API (modo local); en un dominio real es un fallo que hay que mostrar.
      isRemote = false;
      if (!isLocalHost()) issue = { kind: 'http', status: e.status };
    } else {
      // Sin red o tiempo agotado: usar lo último que se supo; si nunca se supo, asumir que hay servidor (salvo en localhost).
      const known = localStorage.getItem('mg_remote');
      isRemote = known ? known === '1' : !isLocalHost();
    }
  }
  const m = location.hash.match(/^#\/reset\/([\w-]+)/);
  if (m) { resetToken = m[1]; history.replaceState(null, '', location.pathname); }
}

// Sesión guardada de un uso anterior: permite abrir la app al instante y comprobarla en segundo plano.
export function cachedSession() {
  if (localStorage.getItem('mg_remote') !== '1' || !localStorage.getItem('mg_token')) return null;
  const u = J('mg_user_cache', null);
  if (!u || !u.id) return null;
  isRemote = true; return u;
}

/* ---------- Auth ---------- */
export async function getUser() {
  if (isRemote) {
    if (!localStorage.getItem('mg_token')) return null;
    try { const { user } = await api('me'); W('mg_user_cache', user); return user; }
    catch (e) {
      if (e.status === 401) { localStorage.removeItem('mg_token'); return null; }
      return J('mg_user_cache', null); // sin conexión: usar la última copia
    }
  }
  const id = localStorage.getItem('mg_local_session');
  const u = id && J('mg_local_users', {})[id];
  return u ? shape({ ...u, ...u.user_metadata }) : null;
}

export async function signUp({ email, password, name, surname }) {
  email = email.trim().toLowerCase();
  if (isRemote) { startSession(await api('signup', { email, password, name, surname }, false)); return { needsConfirm: false }; }
  const users = J('mg_local_users', {});
  if (Object.values(users).some(u => u.email === email)) throw new Error('exists');
  const id = uid();
  users[id] = { id, email, user_metadata: { name, surname }, hash: await sha(password), avatar: '' };
  W('mg_local_users', users); localStorage.setItem('mg_local_session', id);
  return { needsConfirm: false };
}
export async function signIn(email, password) {
  email = email.trim().toLowerCase();
  if (isRemote) { startSession(await api('login', { email, password }, false)); return; }
  const u = Object.values(J('mg_local_users', {})).find(x => x.email === email);
  if (!u || u.hash !== await sha(password)) throw new Error('creds');
  localStorage.setItem('mg_local_session', u.id);
}
export async function signOut() {
  localStorage.removeItem('mg_token'); localStorage.removeItem('mg_local_session'); localStorage.removeItem('mg_user_cache');
}
export async function resetPassword(email) {
  if (!isRemote) throw new Error('local');
  await api('forgot', { email }, false);
}
export async function updatePassword(password) {
  if (isRemote) {
    if (resetToken) { startSession(await api('reset', { token: resetToken, password }, false)); resetToken = null; return; }
    await api('change-password', { password }); return;
  }
  const users = J('mg_local_users', {}); const id = localStorage.getItem('mg_local_session');
  users[id].hash = await sha(password); W('mg_local_users', users);
}
export async function updateProfile(user, patch) {
  // patch: name, surname, email, avatar, prefs
  if (isRemote) { const { user: u } = await api('update-profile', patch); W('mg_user_cache', u); Object.assign(user, u); return; }
  const users = J('mg_local_users', {}); const u = users[user.id];
  if (patch.email && patch.email.trim().toLowerCase() !== u.email && u.hash !== await sha(patch.currentPassword || '')) throw new Error('creds');   // cambiar el correo exige la contraseña actual
  u.user_metadata = { ...u.user_metadata, name: patch.name ?? user.name, surname: patch.surname ?? user.surname, prefs: patch.prefs ?? user.prefs };
  if (patch.email) u.email = patch.email.trim().toLowerCase();
  if ('avatar' in patch) u.avatar = patch.avatar;
  W('mg_local_users', users);
}

/* ---------- Datos ---------- */
// Versión (hash corto) de cada día tal como la tiene el servidor. Se envía al guardar para detectar cambios hechos desde otro dispositivo.
export const revs = {};
const saveRevs = userId => { try { W('mg_revs_' + userId, revs); } catch { /* cuota */ } };
export function loadRevs(userId) { for (const k in revs) delete revs[k]; Object.assign(revs, J('mg_revs_' + userId, {})); }

export async function fetchAll(userId) {
  if (!isRemote) return J('mg_local_data_' + userId, []);
  const { days, revs: r } = await api('days'); const rows = [];
  for (const k in revs) delete revs[k]; Object.assign(revs, r || {}); saveRevs(userId);
  for (const day of Object.keys(days).sort()) days[day].forEach((i, n) => rows.push({ id: i.id, day, position: n, name: i.name, sets: i.sets, note: i.note || '' }));
  return rows;
}
export async function importDays(userId, days) {
  if (isRemote) return api('import-days', { days });
  let all = J('mg_local_data_' + userId, []); const keys = Object.keys(days);
  all = all.filter(r => !keys.includes(r.day)); let exercises = 0;
  for (const day of keys) days[day].forEach((i, n) => { exercises++; all.push({ id: uid(), day, position: n, name: i.name, sets: i.sets, note: i.note || '' }); });
  W('mg_local_data_' + userId, all); return { ok: true, days: keys.length, exercises };
}
export async function resetAll(userId) {
  if (isRemote) { await api('reset-progress'); for (const k in revs) delete revs[k]; saveRevs(userId); return; }
  localStorage.removeItem('mg_local_data_' + userId);
}
// Si el día cambió en otro dispositivo lanza Error('conflict') con {status:409, data:{items, rev}}; force:true sobrescribe.
export async function saveDay(userId, day, items, { force = false } = {}) {
  if (isRemote) {
    const r = await api('save-day', { day, items: items.map(i => ({ id: i.id, name: i.name, sets: i.sets, note: i.note || '' })), base: revs[day] || '', force });
    if (r.rev) revs[day] = r.rev; else delete revs[day];
    saveRevs(userId); return;
  }
  const all = J('mg_local_data_' + userId, []).filter(r => r.day !== day);
  items.forEach((i, n) => all.push({ id: i.id, day, position: n, name: i.name, sets: i.sets, note: i.note || '' }));
  W('mg_local_data_' + userId, all);
}
