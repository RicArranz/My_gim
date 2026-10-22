import { t, setLang, getLang, LANGS, monthNames, weekdayLetters } from './i18n.js';
import * as store from './store.js';
import { stats } from './stats.js';
import * as io from './io.js';
import { buildPDF } from './pdf.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const J = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const W = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* cuota */ } };
const ICON = {
  menu: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  dumb: '<svg viewBox="0 0 24 24"><path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4 20V4M4 20h16M8 16l4-5 3 3 5-7"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M9 21H5V3h4M16 17l5-5-5-5M21 12H9"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg>',
  qr: '<svg viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v6h-4M14 18v2"/></svg>'
};

/* ---------- Estado ---------- */
const S = {
  user: null, db: [], dirty: {}, date: todayISO(), form: null,
  prefs: J('mg_prefs', {}), progress: { tab: 'day', date: todayISO(), exKey: '', metric: 'max' }, authView: null, loadErr: false, conflicts: new Set()
};
let deferredPrompt = null, booted = false;

function todayISO() { return toISO(new Date()); }
function toISO(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const fromISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const fmtDate = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; };
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : NaN; };
const LOC = { es: 'es-ES', gl: 'gl-ES', en: 'en-GB', pt: 'pt-PT', it: 'it-IT', fr: 'fr-FR', de: 'de-DE' };
const fmtNum = n => (Math.round(n * 100) / 100).toLocaleString(LOC[getLang()] || 'es-ES', { maximumFractionDigits: 2 });
const initials = u => ((u.name || u.email || '?')[0] + (u.surname?.[0] || '')).toUpperCase();

/* ---------- Preferencias ---------- */
function applyPrefs() {
  const p = S.prefs, r = document.documentElement;
  const dark = p.mode === 'dark' || ((!p.mode || p.mode === 'auto') && matchMedia('(prefers-color-scheme: dark)').matches);
  r.dataset.theme = dark ? 'dark' : 'light';
  if (p.accent && p.accent !== 'neutral') r.dataset.accent = p.accent; else delete r.dataset.accent;
  setLang(p.lang || 'es');
  const c = dark ? '#1e1e1c' : '#ffffff';
  document.querySelector('meta[name=theme-color]').setAttribute('content', c);
  W('mg_prefs', p);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyPrefs());
async function setPref(patch) {
  if (Object.keys(patch).every(k => (S.prefs[k] ?? (k === 'lang' ? 'es' : null)) === patch[k])) return;
  S.prefs = { ...S.prefs, ...patch }; applyPrefs();
  if (S.user) { S.user.prefs = S.prefs; try { await store.updateProfile(S.user, { prefs: S.prefs }); } catch { /* sin red: queda local */ } }
  route();
}

/* ---------- Datos locales por usuario ---------- */
const kDirty = () => 'mg_dirty_' + S.user.id, kCache = () => 'mg_cache_' + S.user.id, kDraft = () => 'mg_draft_' + S.user.id;
const persistDirty = () => W(kDirty(), S.dirty);
function dayItems(day) {
  if (S.dirty[day]) return S.dirty[day];
  return S.db.filter(r => r.day === day).sort((a, b) => a.position - b.position);
}
function allItems() {
  const out = S.db.filter(r => !(r.day in S.dirty));
  for (const d in S.dirty) S.dirty[d].forEach(i => out.push({ ...i, day: d }));
  return out;
}
function setDay(day, items) { S.dirty[day] = items; persistDirty(); scheduleSync(); }
let lastLoad = 0;
// Carga los datos del servidor. Si falla, usa la copia del dispositivo y lo avisa (S.loadErr) en vez de mostrar «cero entrenos» sin explicación.
async function loadData() {
  try { S.db = await store.fetchAll(S.user.id); W(kCache(), S.db); S.loadErr = false; lastLoad = Date.now(); }
  catch (e) {
    S.db = J(kCache(), []); S.loadErr = true;
    if (e && e.status === 401) await expireSession();
  }
}

/* ---------- Copia automática en la nube ---------- */
// Los días con cambios (S.dirty) se envían solos unos segundos después del último cambio, al salir de la app y al volver la conexión.
// El botón «Guardar entrenamiento del día» sigue funcionando igual. Si el día cambió en otro dispositivo NO se pisa: queda pendiente y avisa al guardar a mano.
const autosyncOn = () => store.isRemote && S.prefs.autosync !== false;
const syncDelay = () => Number(localStorage.getItem('mg_sync_ms')) || 20000;
let syncTimer = null, syncing = false;
function scheduleSync(ms) { clearTimeout(syncTimer); if (autosyncOn() && Object.keys(S.dirty).length) syncTimer = setTimeout(syncDirty, ms ?? syncDelay()); }
async function syncDirty() {
  if (syncing || !S.user || !autosyncOn() || navigator.onLine === false) return;
  const days = Object.keys(S.dirty).filter(d => !S.conflicts.has(d)).sort(); if (!days.length) return;
  syncing = true; let saved = 0, retry = false;
  try {
    for (const day of days) {
      const snap = S.dirty[day]; if (!snap) continue;
      try { await store.saveDay(S.user.id, day, snap); if (S.dirty[day] === snap) delete S.dirty[day]; saved++; }
      catch (e) { if (e && e.status === 409) { S.conflicts.add(day); continue; } if (e && e.status === 401) { await expireSession(); return; } retry = true; break; }
    }
    persistDirty();
    if (saved) { S.db = await store.fetchAll(S.user.id); W(kCache(), S.db); S.loadErr = false; lastLoad = Date.now(); }
  } catch { retry = true; }
  finally { syncing = false; }
  if (retry) scheduleSync(60000);
  if (saved && S.user && !S.form && !document.querySelector('.overlay') && /^#?\/?$/.test(location.hash)) route(true);
}
window.addEventListener('online', () => syncDirty());
document.addEventListener('visibilitychange', () => {
  if (!S.user) return;
  if (document.hidden) { syncDirty(); return; }
  // al volver a la app: traer lo que se haya guardado desde otro dispositivo (sin pisar días con cambios sin guardar)
  if (store.isRemote && Date.now() - lastLoad > 15000 && !S.form && !document.querySelector('.overlay')) loadData().then(() => { if (S.user && !S.form && !document.querySelector('.overlay')) route(true); });
});
async function expireSession() {
  if (!S.user) return;
  await store.signOut(); S.user = null; S.authView = 'login'; renderAuth(); toast(t('sessionExpired'));
}
const loadBanner = () => (S.loadErr && store.isRemote ? `<div class="msg err stack" style="gap:8px"><span>${t('loadErr')}</span><button class="btn ghost" id="retry">${t('retry')}</button></div>` : '');
function bindRetry() {
  const r = $('#retry'); if (!r) return;
  r.onclick = async () => { r.disabled = true; r.textContent = t('loading'); await loadData(); if (S.user) route(true); };
}

/* ---------- Toast / modales ---------- */
function toast(msg) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg; document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
function modal(html, { center = true } = {}) {
  const o = document.createElement('div'); o.className = 'overlay' + (center ? ' center-m' : '');
  o.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  $('#overlays').appendChild(o); return o;
}
const closeModal = o => o && o.remove();

/* ---------- Instalación ---------- */
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const canInstall = () => !isStandalone() && localStorage.getItem('mg_installed') !== '1' && (!!deferredPrompt || isIOS());
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; if (booted) maybeAskInstall(); });
window.addEventListener('appinstalled', () => { localStorage.setItem('mg_installed', '1'); deferredPrompt = null; renderMenu(); });
async function doInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const r = await deferredPrompt.userChoice; deferredPrompt = null;
    if (r.outcome === 'accepted') localStorage.setItem('mg_installed', '1');
    renderMenu();
  } else if (isIOS()) {
    const o = modal(`<h2>${t('installTitle')}</h2><p>${t('installIos')}</p><button class="btn block">OK</button>`);
    o.querySelector('button').onclick = () => closeModal(o);
  }
}
function maybeAskInstall() {
  if (!canInstall() || sessionStorage.getItem('mg_asked')) return;
  sessionStorage.setItem('mg_asked', '1');
  const o = modal(`<h2>${t('installTitle')}</h2><p class="muted">${deferredPrompt ? t('installText') : t('installIos')}</p>
    <div class="actions"><button class="btn ghost" data-a="no">${t('notNow')}</button>${deferredPrompt ? `<button class="btn" data-a="ok">${t('install')}</button>` : ''}</div>`);
  o.onclick = e => { const a = e.target.dataset.a; if (!a) return; closeModal(o); if (a === 'ok') doInstall(); };
}

/* ---------- Arranque ---------- */
async function boot() {
  applyPrefs();
  if ('serviceWorker' in navigator) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(reg => {
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      setInterval(check, 30 * 60 * 1000);
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!had) return; sessionStorage.setItem('mg_updated', '1'); location.reload();
    });
  }
  const minSplash = new Promise(r => setTimeout(r, 300));
  let user = null, fast = false;
  try {
    const cached = /^#\/reset\//.test(location.hash) ? null : store.cachedSession();
    if (cached) { user = cached; fast = true; }            // vuelta de un usuario conocido: abrir al instante y comprobar después
    else {
      try { await store.init(); } catch { /* sin red: modo degradado */ }
      store.onRecovery(() => { S.authView = 'recovery'; });
      try { user = await store.getUser(); } catch { /* ignore */ }
    }
    await minSplash;
    if (user && S.authView !== 'recovery') await enter(user, { fast }); else renderAuth();
  } catch (err) {
    console.error(err);
    try { S.user = null; renderAuth(); } catch { /* nada más que hacer */ }
  } finally {
    const sp = $('#splash'); if (sp) { sp.classList.add('out'); setTimeout(() => sp.remove(), 400); }
  }
  booted = true;
  if (sessionStorage.getItem('mg_updated')) { sessionStorage.removeItem('mg_updated'); toast(t('updated')); }
  if (S.user) { if (!offerResume()) maybeAskInstall(); } else maybeAskInstall();
}

async function enter(user, { fast = false } = {}) {
  S.user = user;
  if (user.prefs && Object.keys(user.prefs).length) S.prefs = { ...S.prefs, ...user.prefs };
  applyPrefs();
  localStorage.setItem('mg_lastuser', JSON.stringify({ email: user.email, name: user.name }));
  S.dirty = J(kDirty(), {}); S.conflicts = new Set(); store.loadRevs(user.id);
  if (fast) { S.db = J(kCache(), []); S.loadErr = false; }
  else { await loadData(); if (!S.user) return; }
  scheduleSync(3000);                                   // por si quedaron días sin enviar de otra vez
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* opcional: pide al navegador no borrar los datos del dispositivo */ }
  S.date = todayISO(); S.form = null;
  renderShell(); route();
  if (fast) refresh();
}

// Segundo plano tras abrir con la copia guardada: valida la sesión y trae los datos al día.
async function refresh() {
  const [u] = await Promise.all([store.getUser().catch(() => null), loadData()]);   // sesión y datos a la vez
  if (!S.user) return;
  if (!u) { if (!localStorage.getItem('mg_token')) await expireSession(); return; }
  Object.assign(S.user, u);
  if (!S.form && !document.querySelector('.overlay')) route(true); else renderMenu();
}

/* ---------- Auth ---------- */
function renderAuth() {
  const last = J('mg_lastuser', null);
  if (store.issue) {   // el servidor no está listo: decirlo claro (antes caía a «modo local» y parecía que se perdían los datos)
    const i = store.issue;
    const msg = i.kind === 'unconfigured' ? t('unconfigured', { vars: (i.missing.length ? i.missing : ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'AUTH_SECRET']).join(', ') }) : t('serverHttp', { status: i.status });
    $('#app').innerHTML = `<div class="auth"><img class="logo-img" src="icons/logo.png" alt="My Gim"><h1>${t('serverDown')}</h1>
      <div class="msg err">${esc(msg)}</div><button class="btn block" id="retrysrv">${t('retry')}</button></div>`;
    $('#retrysrv').onclick = async e => { e.target.disabled = true; e.target.textContent = t('loading'); try { await store.init(); } catch { /* */ } renderAuth(); };
    return;
  }
  const v = S.authView || (last ? 'welcome' : 'login');
  S.authView = v;
  $('#app').innerHTML = `<div class="auth"><img class="logo-img" src="icons/logo.png" alt="My Gim">${authBody(v, last)}
    ${store.isRemote ? '' : `<p class="muted center">${t('localMode')}</p>`}</div>`;
  bindAuth(v, last);
}
function authBody(v, last) {
  if (v === 'welcome') return `<h1>${t('welcome', { name: esc(last.name || last.email) })}</h1>
    <div class="stack"><button class="btn block" id="go">${t('enter')}</button>
    <button class="btn link" id="sw">${t('switchUser')}</button><button class="btn link" id="fg">${t('forgot')}</button></div>`;
  if (v === 'login') return `<h1>${t('login')}</h1><form class="stack" id="f" novalidate>
    <label class="f">${t('email')}<input type="email" name="email" autocomplete="email" value="${esc(last?.email || '')}" required></label>
    <label class="f">${t('password')}<input type="password" name="password" autocomplete="current-password" required></label>
    <div class="msg err hidden" id="m"></div><button class="btn block">${t('login')}</button></form>
    <div class="stack"><button class="btn link" id="fg">${t('forgot')}</button><button class="btn link" id="su">${t('noAccount')}</button></div>`;
  if (v === 'signup') return `<h1>${t('signup')}</h1><form class="stack" id="f" novalidate>
    <label class="f">${t('name')}<input type="text" name="name" autocomplete="given-name" required></label>
    <label class="f">${t('surname')}<input type="text" name="surname" autocomplete="family-name"></label>
    <label class="f">${t('email')}<input type="email" name="email" autocomplete="email" required></label>
    <label class="f">${t('password')}<input type="password" name="password" autocomplete="new-password" required></label>
    <div class="msg err hidden" id="m"></div><button class="btn block">${t('signup')}</button></form>
    <button class="btn link" id="li">${t('haveAccount')}</button>`;
  if (v === 'reset') return `<h1>${t('resetTitle')}</h1><p class="muted center">${t('resetText')}</p><form class="stack" id="f" novalidate>
    <label class="f">${t('email')}<input type="email" name="email" autocomplete="email" value="${esc(last?.email || '')}" required></label>
    <div class="msg hidden" id="m"></div><button class="btn block">${t('sendLink')}</button></form>
    <button class="btn link" id="li">${t('back')}</button>`;
  return `<h1>${t('newPassword')}</h1><form class="stack" id="f" novalidate>
    <label class="f">${t('newPassword')}<input type="password" name="password" autocomplete="new-password" required></label>
    <div class="msg err hidden" id="m"></div><button class="btn block">${t('savePassword')}</button></form>`;
}
function bindAuth(v, last) {
  const go = view => () => { S.authView = view; renderAuth(); };
  const on = (id, fn) => { const el = $('#' + id); if (el) el.onclick = fn; };
  on('su', go('signup')); on('li', go('login')); on('fg', go('reset'));
  on('sw', () => { localStorage.removeItem('mg_lastuser'); S.authView = 'login'; renderAuth(); });
  on('go', async () => {
    let u = null; try { u = await store.getUser(); } catch { /* */ }
    if (u) enter(u); else { S.authView = 'login'; renderAuth(); }
  });
  const f = $('#f'); if (!f) return;
  const m = $('#m'); const show = (txt, ok) => { m.textContent = txt; m.className = 'msg ' + (ok ? 'ok' : 'err'); };
  f.onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(f)); const btn = f.querySelector('button'); btn.disabled = true;
    try {
      if (v === 'login') {
        if (!d.email || !d.password) throw new Error('fields');
        await store.signIn(d.email, d.password); await enter(await store.getUser());
      } else if (v === 'signup') {
        if (!d.email || !d.password || !d.name.trim()) throw new Error('fields');
        if (d.password.length < 6) throw new Error('short');
        const r = await store.signUp({ ...d, name: d.name.trim(), surname: (d.surname || '').trim() });
        if (r.needsConfirm) { S.authView = 'login'; renderAuth(); $('#m').className = 'msg ok'; $('#m').textContent = t('confirmEmail'); }
        else await enter(await store.getUser());
      } else if (v === 'reset') {
        if (!d.email) throw new Error('fields');
        await store.resetPassword(d.email); show(t('resetSent'), true);
      } else {
        if (d.password.length < 6) throw new Error('short');
        await store.updatePassword(d.password); S.authView = null; history.replaceState(null, '', location.pathname);
        toast(t('passwordChanged')); await enter(await store.getUser());
      }
    } catch (err) { show(errText(err), false); btn.disabled = false; }
  };
}
function errText(err) {
  const m = String(err?.message || err);
  if (m === 'fields') return t('errFields'); if (m === 'short') return t('errShort'); if (m === 'exists' || /already/i.test(m)) return t('errExists');
  if (m === 'creds' || /invalid login/i.test(m)) return t('errCreds'); if (m === 'rate') return t('errRate'); if (m === 'token') return t('errToken'); if (m === 'mailconfig') return t('errMailConfig'); if (m === 'mail') return t('errMail'); if (m === 'local') return 'Modo local: no hay correo.';
  if (/fetch|network/i.test(m)) return t('errOffline'); return t('errGeneric');
}

/* ---------- Shell (cabecera + menú) ---------- */
function renderShell() {
  $('#app').innerHTML = `<header class="top"><a class="brand" href="#/" aria-label="${t('workout')}"><img class="logo-img" src="icons/logo.png" alt="My Gim"></a>
    <button class="icon-btn" id="burger" aria-label="${t('menu')}">${ICON.menu}</button></header><main id="view"></main>
    <div class="scrim" id="scrim"></div><aside class="drawer" id="drawer" aria-hidden="true"></aside>`;
  $('#burger').onclick = () => toggleMenu(true); $('#scrim').onclick = () => toggleMenu(false);
  renderMenu();
}
function toggleMenu(on) { $('#drawer').classList.toggle('on', on); $('#scrim').classList.toggle('on', on); $('#drawer').setAttribute('aria-hidden', String(!on)); }
function renderMenu() {
  const d = $('#drawer'); if (!d || !S.user) return;
  const h = location.hash || '#/'; const on = p => (h === p || (p === '#/' && h === '')) ? ' class="on"' : '';
  d.innerHTML = `<div class="who">${avatarHTML(S.user)}<div class="grow"><b>${esc(S.user.name)} ${esc(S.user.surname)}</b><div class="muted" style="overflow:hidden;text-overflow:ellipsis">${esc(S.user.email)}</div></div></div>
    <nav><a href="#/"${on('#/')}>${ICON.dumb}${t('workout')}</a><a href="#/progress"${on('#/progress')}>${ICON.chart}${t('progress')}</a><a href="#/settings"${on('#/settings')}>${ICON.gear}${t('options')}</a><a href="#/files"${on('#/files')}>${ICON.up}${t('files')}</a>
    <button id="qr">${ICON.qr}${t('qrTitle')}</button>
    ${canInstall() ? `<button id="inst">${ICON.dl}${t('install')}</button>` : ''}<span style="flex:1"></span><button id="lo">${ICON.out}${t('logout')}</button></nav>`;
  d.querySelectorAll('a').forEach(a => a.onclick = () => toggleMenu(false));
  $('#qr').onclick = () => { toggleMenu(false); showQR(); };
  const i = $('#inst'); if (i) i.onclick = () => { toggleMenu(false); doInstall(); };
  $('#lo').onclick = async () => { toggleMenu(false); await store.signOut(); S.user = null; S.authView = null; renderAuth(); };
}
const avatarHTML = (u, big) => `<div class="avatar${big ? ' big' : ''}">${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : esc(initials(u))}</div>`;

/* ---------- Código QR de la app ---------- */
function showQR() {
  const url = location.origin + location.pathname;
  const q = window.qrcode(0, 'M'); q.addData(url); q.make();
  const o = modal(`<h2>${t('qrTitle')}</h2><p class="muted" style="margin:0">${t('qrText')}</p>
    <div style="background:#fff;padding:14px;border-radius:14px;align-self:center;width:min(100%,260px)">${q.createSvgTag({ cellSize: 1, margin: 0, scalable: true })}</div>
    <div class="muted center" style="word-break:break-all">${esc(url)}</div>
    <div class="actions"><button class="btn ghost" data-a="copy">${t('copyLink')}</button>${navigator.share ? `<button class="btn ghost" data-a="share">${t('share')}</button>` : ''}</div>
    <button class="btn" data-a="x">${t('close')}</button>`);
  o.onclick = async e => {
    const a = e.target.dataset.a; if (e.target === o || a === 'x') return closeModal(o);
    if (a === 'copy') { try { await navigator.clipboard.writeText(url); toast(t('copied')); } catch { prompt(t('copyLink'), url); } }
    if (a === 'share') navigator.share({ title: 'My Gim', url }).catch(() => {});
  };
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.user) toggleMenu(false); });

/* ---------- Router ---------- */
window.addEventListener('hashchange', () => { if (S.user) { document.querySelectorAll('.overlay').forEach(o => o.remove()); S.form = null; route(); } });
function route(keepScroll) {
  if (!S.user || !$('#view')) return;
  const h = location.hash.replace(/^#/, '') || '/', y = window.scrollY;
  if (h.startsWith('/progress')) viewProgress(); else if (h.startsWith('/settings')) viewSettings(); else if (h.startsWith('/files')) viewFiles(); else viewWorkout();
  renderMenu(); window.scrollTo(0, keepScroll ? y : 0);
}

/* ---------- Entrenamiento ---------- */
function viewWorkout() {
  const day = S.date, items = dayItems(day), pend = day in S.dirty;
  const isToday = day === todayISO();
  const draft = freshDraft();
  const others = Object.keys(S.dirty).filter(d => d !== day).sort();
  $('#view').innerHTML = `<div class="stack">${loadBanner()}
    <div class="daynav"><button class="icon-btn" id="dp" aria-label="${t('prev')}">${ICON.prev}</button>
      <div class="date">${isToday ? t('today') + ' · ' : ''}${fmtDate(day)}<input type="date" id="dd" value="${day}" aria-label="${t('date')}"></div>
      <button class="icon-btn" id="dn" aria-label="${t('next')}">${ICON.next}</button></div>
    ${others.length ? `<button class="btn ghost block" id="unsaved">⚠ ${t('unsavedDays', { n: others.length })} · ${fmtDate(others[0])}</button>` : ''}
    ${draft && draft.date === day ? `<button class="btn ghost block" id="resume">↩ ${t('resumeTitle')}: ${esc(draft.name || t('exercise'))}</button>` : ''}
    ${items.length ? items.map((it, i) => exCard(it, i)).join('') : `<div class="empty">${t('noExercises')}</div>`}
    <button class="btn ${items.length ? 'ghost' : ''} block" id="add">+ ${t('newExercise')}</button></div>
    <div class="savebar"><div><button class="btn block" id="saveday" ${items.length || pend ? '' : 'disabled'}>${t('saveDay')}</button>
    <div class="status ${pend ? 'pend' : (items.length ? 'done' : '')}">${pend ? (autosyncOn() && !S.conflicts.has(day) ? t('dayPendingAuto') : t('dayPending')) : (items.length ? '✓ ' + t('daySavedAt') : '')}</div></div></div>`;
  $('#dp').onclick = () => { S.date = addDays(day, -1); viewWorkout(); };
  $('#dn').onclick = () => { S.date = addDays(day, 1); viewWorkout(); };
  $('#dd').onchange = e => { if (e.target.value) { S.date = e.target.value; viewWorkout(); } };
  $('#add').onclick = () => openForm(null);
  if ($('#unsaved')) $('#unsaved').onclick = () => { S.date = others[0]; viewWorkout(); };
  if ($('#resume')) $('#resume').onclick = () => openForm(draft);
  document.querySelectorAll('.ex').forEach(el => el.onclick = () => openForm(null, +el.dataset.i));
  $('#saveday').onclick = saveDay;
  bindRetry();
}
const setChip = s => `<span class="chip">${fmtNum(s.weight)} kg × ${s.reps}</span>`;
const setsLabel = n => n === 1 ? (getLang() === 'de' ? t('set') : t('set').toLowerCase()) : t('sets');
const vol = it => it.sets.reduce((a, s) => a + s.weight * s.reps, 0);
function exCard(it, i) {
  return `<button class="card ex" data-i="${i}"><div class="row between"><h3>${esc(it.name)}</h3><span class="muted">${it.sets.length} ${setsLabel(it.sets.length)} · ${fmtNum(vol(it))} kg</span></div>
    <div class="sets">${it.sets.map(setChip).join('')}</div>${it.note ? `<div class="muted">${esc(it.note)}</div>` : ''}</button>`;
}
async function saveDay() {
  const day = S.date, btn = $('#saveday'); btn.disabled = true; btn.textContent = t('saving');
  const items = dayItems(day);
  try {
    try { await store.saveDay(S.user.id, day, items); }
    catch (e) {
      if (!(e && e.status === 409)) throw e;
      const choice = await askConflict(items, e.data && e.data.items || []);      // el día cambió en otro dispositivo
      if (choice === 'mine') await store.saveDay(S.user.id, day, items, { force: true });
      else if (choice !== 'server') { if (S.user) viewWorkout(); return; }
    }
    delete S.dirty[day]; S.conflicts.delete(day); persistDirty();
    S.db = await store.fetchAll(S.user.id); W(kCache(), S.db);
    toast('✓ ' + t('daySaved'));
  } catch (e) { if (e && e.status === 401) return expireSession(); toast(t('saveError')); }
  if (S.user) viewWorkout();
}
function askConflict(mine, server) {
  return new Promise(res => {
    const o = modal(`<h2>${t('conflictTitle')}</h2><p style="margin:0">${t('conflictText', { server: server.length, mine: mine.length })}</p>
      <button class="btn" data-a="server">${t('conflictServer')}</button><button class="btn ghost" data-a="mine">${t('conflictMine')}</button>
      <button class="btn link" data-a="no">${t('cancel')}</button>`);
    o.onclick = e => { const x = e.target.dataset.a; if (!x) return; closeModal(o); res(x === 'no' ? null : x); };
  });
}

/* Formulario de ejercicio (hoja inferior). Se autoguarda como borrador. */
const DRAFT_MS = 30 * 60 * 1000;
function freshDraft() {
  const d = J(kDraft(), null);
  if (d && Date.now() - d.ts < DRAFT_MS) return d;
  if (d) localStorage.removeItem(kDraft());
  return null;
}
function offerResume() {
  const d = freshDraft(); if (!d) return false;
  const o = modal(`<h2>${t('resumeTitle')}</h2><p>${t('resumeText')}</p><p class="muted">${esc(d.name || t('exercise'))} · ${fmtDate(d.date)}</p>
    <div class="actions"><button class="btn ghost" data-a="no">${t('no')}</button><button class="btn" data-a="yes">${t('yes')}</button></div>`);
  o.onclick = e => {
    const a = e.target.dataset.a; if (!a) return; closeModal(o);
    if (a === 'yes') { S.date = d.date; if (location.hash.replace('#', '') !== '/' && location.hash !== '') location.hash = '#/'; viewWorkout(); openForm(d); }
    else { localStorage.removeItem(kDraft()); maybeAskInstall(); }
  };
  return true;
}
function closeForm(o) { closeModal(o); if (history.state && history.state.mgform) history.back(); }
window.addEventListener('popstate', () => {
  const o = document.querySelector('.overlay[data-form]');
  if (o) { o.remove(); S.form = null; if (S.user) viewWorkout(); } // atrás = salir sin perder el borrador
});
function knownNames() {
  const c = {}; allItems().forEach(i => { const k = i.name.trim(); c[k] = (c[k] || 0) + 1; });
  return Object.keys(c).sort((a, b) => c[b] - c[a]);
}
function openForm(draft, index) {
  const day = draft ? draft.date : S.date;
  let f;
  if (draft) f = { date: day, index: draft.index ?? null, name: draft.name, sets: draft.sets, note: draft.note || '' };
  else if (index != null) { const it = dayItems(day)[index]; f = { date: day, index, name: it.name, sets: it.sets.map(s => ({ weight: String(s.weight), reps: String(s.reps) })), note: it.note || '' }; }
  else f = { date: day, index: null, name: '', sets: [{ weight: '', reps: '' }], note: '' };
  if (!f.sets.length) f.sets = [{ weight: '', reps: '' }];
  S.form = f;
  const o = modal('', { center: false }); const sheet = o.firstElementChild; o.dataset.form = '1';
  history.pushState({ mgform: 1 }, '');
  const persist = () => {
    const empty = !f.name.trim() && f.sets.every(s => !s.weight && !s.reps);
    if (empty) localStorage.removeItem(kDraft()); else W(kDraft(), { ...f, ts: Date.now() });
  };
  const draw = () => {
    sheet.innerHTML = `<h2>${f.index != null ? t('editExercise') : t('newExercise')}</h2>
      <label class="f">${t('exerciseName')}<input type="text" id="fn" list="names" value="${esc(f.name)}" autocomplete="off" autocapitalize="sentences"></label>
      <datalist id="names">${knownNames().map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="stack" style="gap:8px"><div class="sethead"><span>#</span><span>${t('weight')}</span><span>${t('repsLong')}</span><span></span></div>
      ${f.sets.map((s, i) => `<div class="setrow"><span class="n">${i + 1}</span>
        <input type="text" inputmode="decimal" data-k="weight" data-i="${i}" value="${esc(s.weight)}" placeholder="0" aria-label="${t('weight')} ${t('set')} ${i + 1}">
        <input type="text" inputmode="numeric" data-k="reps" data-i="${i}" value="${esc(s.reps)}" placeholder="0" aria-label="${t('repsLong')} ${t('set')} ${i + 1}">
        <button class="x" data-rm="${i}" aria-label="${t('removeSet')}" ${f.sets.length < 2 ? 'disabled' : ''}>×</button></div>`).join('')}
      <button class="btn ghost" id="as">+ ${t('addSet')}</button></div>
      <label class="f">${t('note')}<input type="text" id="fnote" value="${esc(f.note)}" maxlength="200" autocomplete="off"></label>
      <div class="msg err hidden" id="fm"></div>
      <div class="actions"><button class="btn ghost" id="fc">${t('cancel')}</button><button class="btn" id="fs">${t('save')}</button></div>
      ${f.index != null ? `<button class="btn danger" id="fd">${t('delete')}</button>` : ''}`;
    sheet.querySelector('#fn').oninput = e => { f.name = e.target.value; persist(); };
    sheet.querySelector('#fnote').oninput = e => { f.note = e.target.value; persist(); };
    sheet.querySelectorAll('.setrow input').forEach(inp => inp.oninput = () => { f.sets[+inp.dataset.i][inp.dataset.k] = inp.value; persist(); });
    sheet.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { f.sets.splice(+b.dataset.rm, 1); persist(); draw(); });
    sheet.querySelector('#as').onclick = () => { const l = f.sets[f.sets.length - 1] || {}; f.sets.push({ weight: l.weight || '', reps: l.reps || '' }); persist(); draw(); const ins = sheet.querySelectorAll('.setrow input'); ins[ins.length - 1].focus(); ins[ins.length - 1].select(); };
    sheet.querySelector('#fc').onclick = () => { localStorage.removeItem(kDraft()); S.form = null; closeForm(o); viewWorkout(); };
    sheet.querySelector('#fs').onclick = () => {
      const name = f.name.trim(); const msg = sheet.querySelector('#fm');
      const sets = f.sets.map(s => ({ weight: num(s.weight || 0), reps: Math.round(num(s.reps)) })).filter(s => s.reps > 0 && s.weight >= 0);
      if (!name) { msg.textContent = t('needName'); msg.classList.remove('hidden'); return; }
      if (!sets.length) { msg.textContent = t('needSet'); msg.classList.remove('hidden'); return; }
      const items = dayItems(f.date).map(x => ({ ...x }));
      const it = { id: f.index != null ? items[f.index].id : store.uid(), name, sets, note: f.note.trim() };
      if (f.index != null) items[f.index] = it; else items.push(it);
      setDay(f.date, items); localStorage.removeItem(kDraft()); S.form = null; S.date = f.date; closeForm(o); viewWorkout();
    };
    const del = sheet.querySelector('#fd');
    if (del) del.onclick = () => { if (!confirm(t('confirmDelete'))) return; const items = dayItems(f.date).filter((_, i) => i !== f.index); setDay(f.date, items); localStorage.removeItem(kDraft()); S.form = null; closeForm(o); viewWorkout(); };
  };
  draw();
}

/* ---------- Progreso ---------- */
function viewProgress() {
  const P = S.progress, items = allItems().filter(i => i.sets.length), st = stats(items);
  if (!items.length) { $('#view').innerHTML = `<div class="stack">${loadBanner()}<div class="empty">${t('noData')}</div><a class="btn ghost block" href="#/files">${t('importTitle')}</a></div>`; bindRetry(); return; }
  const mn = monthNames();
  const kpi = (v, l) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`;
  let body = '';
  if (P.tab === 'day') body = progDay(items);
  else if (P.tab === 'month') body = progMonth(st, mn);
  else body = progYear(st, mn);
  $('#view').innerHTML = `<div class="stack">${loadBanner()}
    <div class="kpis">${kpi(st.sessions, t('sessions'))}${kpi(st.totalSets, t('totalSets'))}${kpi(fmtNum(st.totalVolume / 1000) + ' t', t('totalVolume'))}${kpi(st.streakWeeks, t('streak'))}</div>
    <p class="muted center" style="margin:0">${t('since')} ${fmtDate(st.first)}</p>
    <div class="tabs">${['day', 'month', 'year'].map(k => `<button data-tab="${k}" class="${P.tab === k ? 'on' : ''}">${t(k)}</button>`).join('')}</div>
    ${body}${progEvolution(st)}${progTop(st)}${progRecords(st)}${progWipe()}</div>`;
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { P.tab = b.dataset.tab; viewProgress(); });
  bindProgress(st); bindRetry();
}
const dayList = day => {
  const its = allItems().filter(i => i.day === day);
  if (!its.length) return `<div class="empty">${t('noExercises')}</div>`;
  return its.map(it => `<div class="card stack" style="gap:8px"><div class="row between"><h3>${esc(it.name)}</h3><span class="muted">${fmtNum(vol(it))} kg</span></div><div class="sets">${it.sets.map(setChip).join('')}</div>${it.note ? `<div class="muted">${esc(it.note)}</div>` : ''}</div>`).join('');
};
function progDay() {
  const d = S.progress.date;
  return `<div class="daynav"><button class="icon-btn" data-nav="d-1">${ICON.prev}</button><div class="date">${fmtDate(d)}<input type="date" id="pd" value="${d}"></div><button class="icon-btn" data-nav="d+1">${ICON.next}</button></div>
    ${dayList(d)}<a class="btn ghost block" href="#/" id="goedit">${t('workout')}</a>`;
}
function progMonth(st, mn) {
  const P = S.progress, d = fromISO(P.date), y = d.getFullYear(), m = d.getMonth();
  const first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
  const ms = st.byMonth[`${y}-${String(m + 1).padStart(2, '0')}`] || { sessions: 0, volume: 0 };
  let cells = weekdayLetters().map(w => `<div class="h">${w}</div>`).join('') + '<div class="blank"></div>'.repeat(lead);
  for (let i = 1; i <= days; i++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    cells += `<button data-day="${iso}" class="${st.days.has(iso) ? 'tr ' : ''}${iso === todayISO() ? 'td ' : ''}${iso === P.date ? 'sel' : ''}">${i}</button>`;
  }
  return `<div class="daynav"><button class="icon-btn" data-nav="m-1">${ICON.prev}</button><div class="date">${mn[m]} ${y}</div><button class="icon-btn" data-nav="m+1">${ICON.next}</button></div>
    <div class="row"><span class="chip">${ms.sessions} ${t('sessions')}</span><span class="chip">${fmtNum(ms.volume)} kg</span></div>
    <div class="card"><div class="cal">${cells}</div></div><h3>${fmtDate(P.date)}</h3>${dayList(P.date)}`;
}
function progYear(st, mn) {
  const P = S.progress, y = fromISO(P.date).getFullYear();
  const vals = mn.map((_, i) => (st.byMonth[`${y}-${String(i + 1).padStart(2, '0')}`] || { volume: 0 }).volume);
  const max = Math.max(...vals, 1), W_ = 340, H = 170, bw = 20, gap = (W_ - 12 * bw) / 13;
  const bars = vals.map((v, i) => { const h = Math.max(v ? 3 : 0, v / max * 120), x = gap + i * (bw + gap);
    return `<g data-month="${i}" style="cursor:pointer"><rect class="bar" x="${x}" y="${140 - h}" width="${bw}" height="${h}" rx="4"/><text x="${x + bw / 2}" y="158" text-anchor="middle">${mn[i].slice(0, 3)}</text></g>`; }).join('');
  const total = vals.reduce((a, b) => a + b, 0), ses = Object.entries(st.byMonth).filter(([k]) => k.startsWith(y + '-')).reduce((a, [, v]) => a + v.sessions, 0);
  return `<div class="daynav"><button class="icon-btn" data-nav="y-1">${ICON.prev}</button><div class="date">${y}</div><button class="icon-btn" data-nav="y+1">${ICON.next}</button></div>
    <div class="row"><span class="chip">${ses} ${t('sessions')}</span><span class="chip">${fmtNum(total)} kg</span></div>
    <div class="card"><h3 style="margin-bottom:8px">${t('monthlyVolume')}</h3><svg class="chart" viewBox="0 0 ${W_} ${H}"><line class="grid" x1="0" x2="${W_}" y1="140" y2="140"/>${bars}</svg></div>`;
}
function bindProgress(st) {
  const P = S.progress;
  document.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => {
    const [u, s] = [b.dataset.nav[0], b.dataset.nav.slice(1)], n = +s, d = fromISO(P.date);
    if (u === 'd') P.date = addDays(P.date, n);
    else if (u === 'm') { d.setDate(1); d.setMonth(d.getMonth() + n); P.date = toISO(d); }
    else { d.setFullYear(d.getFullYear() + n); P.date = toISO(d); }
    viewProgress();
  });
  const pd = $('#pd'); if (pd) pd.onchange = e => { if (e.target.value) { P.date = e.target.value; viewProgress(); } };
  document.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { P.date = b.dataset.day; viewProgress(); });
  document.querySelectorAll('[data-month]').forEach(g => g.onclick = () => { const d = fromISO(P.date); d.setDate(1); d.setMonth(+g.dataset.month); P.date = toISO(d); P.tab = 'month'; viewProgress(); });
  const wp = $('#wipe'); if (wp) wp.onclick = wipeProgress;
  const ge = $('#goedit'); if (ge) ge.onclick = () => { S.date = P.date; };
  const ex = $('#exsel'); if (ex) ex.onchange = e => { P.exKey = e.target.value; viewProgress(); };
  document.querySelectorAll('[data-metric]').forEach(b => b.onclick = () => { P.metric = b.dataset.metric; viewProgress(); });
}
function progEvolution(st) {
  const P = S.progress; const keys = Object.keys(st.byEx).sort((a, b) => st.byEx[b].count - st.byEx[a].count);
  if (!keys.includes(P.exKey)) P.exKey = keys[0];
  const ex = st.byEx[P.exKey], metric = P.metric;
  const pts = ex.series.map(p => ({ d: p.day, v: metric === 'max' ? p.max : metric === 'rm' ? p.rm : p.vol }));
  const first = pts[0].v, last = pts[pts.length - 1].v, pct = first ? (last - first) / first * 100 : 0;
  return `<div class="card stack"><h2>${t('evolution')}</h2>
    <select id="exsel" aria-label="${t('pickExercise')}">${keys.map(k => `<option value="${esc(k)}" ${k === P.exKey ? 'selected' : ''}>${esc(st.byEx[k].name)}</option>`).join('')}</select>
    <div class="tabs">${[['max', 'maxWeight'], ['rm', 'est1rm'], ['vol', 'volume']].map(([k, l]) => `<button data-metric="${k}" class="${metric === k ? 'on' : ''}">${t(l)}</button>`).join('')}</div>
    <div class="row between"><div><div class="big-delta ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '+' : ''}${fmtNum(pct)}%</div><div class="muted">${t('gain')}</div></div>
    <div style="text-align:right"><b>${fmtNum(first)} → ${fmtNum(last)} kg</b><div class="muted">${fmtDate(pts[0].d)} → ${fmtDate(pts[pts.length - 1].d)}</div></div></div>
    ${lineChart(pts)}</div>`;
}
function lineChart(pts) {
  const W_ = 340, H = 180, L = 38, R = 14, T = 14, B = 26;
  const xs = pts.map(p => fromISO(p.d).getTime()), x0 = Math.min(...xs), x1 = Math.max(...xs);
  let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
  if (hi === lo) { hi += 1; lo = Math.max(0, lo - 1); }
  const pad = (hi - lo) * .12; lo = Math.max(0, lo - pad); hi += pad;
  const X = i => pts.length === 1 ? (L + W_ - R) / 2 : L + (xs[i] - x0) / (x1 - x0 || 1) * (W_ - L - R);
  const Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const grid = [0, .5, 1].map(f => { const v = lo + (hi - lo) * f, y = Y(v); return `<line class="grid" x1="${L}" x2="${W_ - R}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 3}" text-anchor="end">${fmtNum(v)}</text>`; }).join('');
  const path = pts.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
  const dots = pts.length <= 40 ? pts.map((p, i) => `<circle class="dot" cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="3.5"><title>${fmtDate(p.d)}: ${fmtNum(p.v)}</title></circle>`).join('') : '';
  const lastI = pts.length - 1;
  return `<svg class="chart" viewBox="0 0 ${W_} ${H}" role="img">${grid}<path class="ln" d="${path}"/>${dots}
    <text x="${L}" y="${H - 8}">${fmtDate(pts[0].d)}</text><text x="${W_ - R}" y="${H - 8}" text-anchor="end">${fmtDate(pts[lastI].d)}</text></svg>`;
}
function progTop(st) {
  const top = Object.values(st.byEx).sort((a, b) => b.count - a.count).slice(0, 5), max = top[0].count;
  return `<div class="card stack"><h2>${t('topExercises')}</h2><div class="bars">${top.map(e => `<div class="b"><span>${esc(e.name)}</span><b>${e.count}</b><div class="track"><i style="width:${e.count / max * 100}%"></i></div></div>`).join('')}</div></div>`;
}
const progWipe = () => `<div class="card stack"><h2>${t('wipeBtn')}</h2><p class="muted" style="margin:0">${t('wipeHint')}</p><button class="btn danger" id="wipe">${t('wipeBtn')}</button></div>`;

// Restaurar progreso: borra todos los entrenamientos (servidor y dispositivo). Pide escribir una palabra para evitar toques accidentales.
function wipeProgress() {
  const items = allItems().filter(i => i.sets.length), days = new Set(items.map(i => i.day)).size, word = t('wipeWord');
  const o = modal(`<h2>${t('wipeTitle')}</h2><p style="margin:0">${t('wipeText', { days, ex: items.length })}</p>
    <button class="btn ghost" data-a="bk">${t('wipeBackup')}</button>
    <label class="f">${t('wipeType', { word })}<input type="text" id="wt" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
    <div class="msg err hidden" id="wm"></div>
    <div class="actions"><button class="btn ghost" data-a="no">${t('cancel')}</button><button class="btn danger-solid" data-a="ok" disabled>${t('wipeConfirm')}</button></div>`);
  const ok = o.querySelector('[data-a=ok]'), inp = o.querySelector('#wt');
  inp.oninput = () => { ok.disabled = inp.value.trim().toLocaleUpperCase() !== word.toLocaleUpperCase(); };
  o.onclick = async e => {
    const act = e.target.dataset.a; if (!act) return;
    if (act === 'no') return closeModal(o);
    if (act === 'bk') return saveBlob([io.toJSONText(io.itemsToDays(items))], `my-gim-copia-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`, 'application/json');
    if (ok.disabled) return;
    ok.disabled = true; ok.textContent = t('saving');
    try {
      await store.resetAll(S.user.id);                       // primero el servidor: si falla, no se toca nada
      S.db = []; S.dirty = {}; persistDirty(); W(kCache(), []); localStorage.removeItem(kDraft());
      S.progress.exKey = ''; closeModal(o); toast(t('wipeDone')); route();
    } catch { const m = o.querySelector('#wm'); m.textContent = t('wipeFail'); m.classList.remove('hidden'); ok.textContent = t('wipeConfirm'); ok.disabled = false; }
  };
}
function progRecords(st) {
  const rec = Object.values(st.byEx).sort((a, b) => b.pr.weight - a.pr.weight).slice(0, 8);
  return `<div class="card stack"><h2>${t('records')}</h2>${rec.map(e => `<div class="row between"><span>${esc(e.name)}</span><span><b>${fmtNum(e.pr.weight)} kg × ${e.pr.reps}</b> <span class="muted">${fmtDate(e.pr.day)}</span></span></div>`).join('')}</div>`;
}

/* ---------- Subir archivos: importar / exportar ---------- */
const readText = f => (f.text ? f.text() : new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsText(f); }));
async function saveBlob(parts, name, type) {
  const blob = new Blob(parts, { type });
  const file = typeof File === 'function' ? new File([blob], name, { type }) : null;
  if (isIOS() && file && navigator.canShare && navigator.canShare({ files: [file] })) {   // en iPhone/iPad la hoja «Compartir» permite guardar en Archivos
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob), el = document.createElement('a');
  el.href = url; el.download = name; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
}
const importErr = e => ({ empty: t('importEmpty'), format: t('importFormat'), tooMany: t('importTooMany') }[String(e && e.message)] || t('importFail'));

function viewFiles() {
  const days = io.itemsToDays(allItems()), keys = Object.keys(days);
  $('#view').innerHTML = `<div class="stack">${loadBanner()}
    <div class="card stack"><h2>${t('importTitle')}</h2><p class="muted" style="margin:0">${t('importText')}</p>
      <label class="btn" style="cursor:pointer">${t('chooseFile')}<input type="file" id="imp" hidden></label>
      <button class="btn link" id="tpl">${t('template')}</button><div class="msg hidden" id="im"></div></div>
    <div class="card stack"><h2>${t('exportTitle')}</h2>
      ${keys.length ? `<div class="row"><label class="f grow">${t('from')}<input type="date" id="xf" value="${keys[0]}"></label><label class="f grow">${t('to')}<input type="date" id="xt" value="${keys[keys.length - 1]}"></label></div>
      <button class="btn" id="xpdf">${t('exportPdf')}</button><div class="actions"><button class="btn ghost" id="xjson">${t('exportJson')}</button><button class="btn ghost" id="xcsv">${t('exportCsv')}</button></div>` : `<div class="muted">${t('noData')}</div>`}
      <div class="msg hidden" id="xm"></div></div></div>`;
  bindRetry();
  const say = (el, txt, ok) => { el.textContent = txt; el.className = 'msg ' + (ok ? 'ok' : 'err'); };
  const im = $('#im'), xm = $('#xm');
  $('#tpl').onclick = () => saveBlob([io.templateCSV()], 'plantilla-my-gim.csv', 'text/csv');

  $('#imp').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let r; try { r = io.parseImport(await readText(f), f.name); } catch (err) { return say(im, importErr(err), false); }
    const clash = Object.keys(r.days).filter(d => dayItems(d).length).length, sk = r.skipped.exercises + r.skipped.sets + r.skipped.dates, s = r.stats;
    const o = modal(`<h2>${t('importTitle')}</h2><p style="margin:0">${esc(f.name)}</p>
      <p style="margin:0"><b>${t('importPreview', { days: s.days, ex: s.exercises, sets: s.sets, from: fmtDate(s.from), to: fmtDate(s.to) })}</b></p>
      ${clash ? `<div class="msg">${t('importReplace', { n: clash })}</div>` : ''}${sk ? `<div class="msg">${t('importSkipped', { n: sk })}</div>` : ''}
      <div class="actions"><button class="btn ghost" data-a="no">${t('cancel')}</button><button class="btn" data-a="ok">${t('importConfirm')}</button></div>`);
    o.onclick = async ev => {
      const act = ev.target.dataset.a; if (!act) return;
      if (act === 'no') return closeModal(o);
      ev.target.disabled = true; ev.target.textContent = t('saving');
      try {
        const res = await store.importDays(S.user.id, r.days);
        for (const d of Object.keys(r.days)) delete S.dirty[d];
        persistDirty(); S.db = await store.fetchAll(S.user.id); W(kCache(), S.db); S.loadErr = false;
        closeModal(o); viewFiles(); say($('#im'), t('importDone', { days: res.days, ex: res.exercises }), true);
        const lk = document.createElement('a'); lk.href = '#/progress'; lk.className = 'btn ghost'; lk.textContent = t('progress'); $('#im').after(lk);
      } catch (err) { closeModal(o); say(im, errText(err) === t('errGeneric') ? t('importFail') : errText(err), false); }
    };
  };
  if (!keys.length) return;

  const range = () => {
    const from = $('#xf').value, to = $('#xt').value;
    const sel = Object.fromEntries(Object.entries(days).filter(([d]) => (!from || d >= from) && (!to || d <= to)));
    if (!Object.keys(sel).length) { say(xm, t('pdfEmpty'), false); return null; }
    xm.className = 'msg hidden'; return sel;
  };
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  $('#xjson').onclick = () => { const sel = range(); if (sel) saveBlob([io.toJSONText(sel)], `my-gim-entrenos-${stamp}.json`, 'application/json'); };
  $('#xcsv').onclick = () => { const sel = range(); if (sel) saveBlob([io.toCSVText(sel)], `my-gim-entrenos-${stamp}.csv`, 'text/csv'); };
  $('#xpdf').onclick = () => {
    const sel = range(); if (!sel) return;
    const flat = Object.entries(sel).flatMap(([day, list]) => list.map(i => ({ ...i, day }))), st = stats(flat), ks = Object.keys(sel);
    const loc = LOC[getLang()] || 'es-ES', wd = d => { const s = fromISO(d).toLocaleDateString(loc, { weekday: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1); };
    const summary = sets => { const out = []; for (let i = 0; i < sets.length;) { let j = i; while (j + 1 < sets.length && sets[j + 1].weight === sets[i].weight && sets[j + 1].reps === sets[i].reps) j++; out.push(`${j - i + 1} x ${sets[i].reps} @ ${fmtNum(sets[i].weight)} kg`); i = j + 1; } return out.join('   |   '); };
    const bytes = buildPDF({
      title: t('pdfTitle'),
      lines: [`${S.user.name} ${S.user.surname}`.trim() + ' · ' + S.user.email,
        `${fmtDate(ks[0])} - ${fmtDate(ks[ks.length - 1])} · ${st.sessions} ${t('sessions')} · ${st.totalSets} ${t('totalSets')} · ${fmtNum(st.totalVolume)} kg`],
      footer: 'My Gim · ' + new Date().toLocaleDateString(loc),
      days: ks.map(d => ({ heading: `${wd(d)} ${fmtDate(d)}`, exercises: sel[d].map(ex => ({ name: ex.name, detail: summary(ex.sets), note: ex.note })) }))
    });
    saveBlob([bytes], `my-gim-entrenos-${stamp}.pdf`, 'application/pdf');
  };
}

/* ---------- Opciones ---------- */
const ACCENTS = [['neutral', '#2b2b29'], ['blue', '#3b6fd4'], ['green', '#3f8a5f'], ['orange', '#d9722b'], ['purple', '#7a5bc7'], ['rose', '#cc4f78'], ['teal', '#2a8f98']];
function viewSettings() {
  const u = S.user, p = S.prefs;
  $('#view').innerHTML = `<div class="stack">
    <div class="card stack"><h2>${t('profile')}</h2>
      <div class="row" style="justify-content:center">${avatarHTML(u, true)}</div>
      <div class="photobtns"><label class="btn ghost" style="cursor:pointer">${t('fromGallery')}<input type="file" accept="image/*" id="pg" hidden></label>
      <label class="btn ghost" style="cursor:pointer">${t('fromCamera')}<input type="file" accept="image/*" capture="user" id="pc" hidden></label>
      <button class="btn ghost${u.avatar ? '' : ' sel'}" id="rp">${t('noPhoto')}</button></div>
      <label class="f">${t('name')}<input type="text" id="pn" value="${esc(u.name)}"></label>
      <label class="f">${t('surname')}<input type="text" id="ps" value="${esc(u.surname)}"></label>
      <label class="f">${t('email')}<input type="email" id="pe" value="${esc(u.email)}"></label>
      <label class="f hidden" id="pcw">${t('currentPassword')}<input type="password" id="pcur" autocomplete="current-password"></label>
      <div class="msg hidden" id="pm"></div><button class="btn" id="psave">${t('save')}</button></div>
    <div class="card stack"><h2>${t('appearance')}</h2>
      <div class="tabs">${[['light', 'light'], ['dark', 'dark'], ['auto', 'auto']].map(([k, l]) => `<button data-mode="${k}" class="${(p.mode || 'auto') === k ? 'on' : ''}">${t(l)}</button>`).join('')}</div>
      <div class="muted">${t('colors')}</div><div class="seg">${ACCENTS.map(([k, c]) => `<button class="swatch ${(p.accent || 'neutral') === k ? 'on' : ''}" data-accent="${k}" style="background:${c}" aria-label="${k}"></button>`).join('')}</div></div>
    ${store.isRemote ? `<div class="card stack"><h2>${t('autosyncTitle')}</h2><p class="muted" style="margin:0">${t('autosyncHint')}</p>
      <div class="tabs">${[[true, 'on'], [false, 'off']].map(([v, l]) => `<button data-autosync="${v}" class="${(p.autosync !== false) === v ? 'on' : ''}">${t(l)}</button>`).join('')}</div></div>` : ''}
    <div class="card stack"><h2>${t('language')}</h2><select id="lang">${Object.entries(LANGS).map(([k, n]) => `<option value="${k}" ${getLang() === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="card stack"><h2>${t('account')}</h2>
      <label class="f">${t('newPassword')}<input type="password" id="np" autocomplete="new-password"></label>
      <div class="msg hidden" id="nm"></div><button class="btn ghost" id="npb">${t('changePassword')}</button>
      ${canInstall() ? `<button class="btn ghost" id="inst2">${t('install')}</button>` : ''}</div></div>`;
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setPref({ mode: b.dataset.mode }));
  document.querySelectorAll('[data-accent]').forEach(b => b.onclick = () => setPref({ accent: b.dataset.accent }));
  document.querySelectorAll('[data-autosync]').forEach(b => b.onclick = () => setPref({ autosync: b.dataset.autosync === 'true' }).then(() => scheduleSync(3000)));
  $('#pe').oninput = () => $('#pcw').classList.toggle('hidden', $('#pe').value.trim().toLowerCase() === u.email);   // cambiar el correo pide la contraseña
  $('#lang').onchange = e => setPref({ lang: e.target.value }).then(() => renderShell() || route());
  const i2 = $('#inst2'); if (i2) i2.onclick = doInstall;
  const pm = $('#pm'), say = (el, txt, ok) => { el.textContent = txt; el.className = 'msg ' + (ok ? 'ok' : 'err'); };
  $('#psave').onclick = async () => {
    const patch = { name: $('#pn').value.trim(), surname: $('#ps').value.trim(), email: $('#pe').value.trim() };
    if (!patch.name || !patch.email) return say(pm, t('errFields'), false);
    if (patch.email.toLowerCase() !== u.email) { patch.currentPassword = $('#pcur').value; if (!patch.currentPassword) return say(pm, t('needPasswordEmail'), false); }
    try { await store.updateProfile(u, patch); delete patch.currentPassword; Object.assign(u, patch, { email: patch.email.toLowerCase() });
      localStorage.setItem('mg_lastuser', JSON.stringify({ email: u.email, name: u.name })); say(pm, t('saved'), true); renderMenu(); }
    catch (e) { say(pm, errText(e), false); }
  };
  const photo = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const a = await resizeAvatar(f); await store.updateProfile(u, { avatar: a }); u.avatar = a; viewSettings(); renderMenu(); } catch (er) { toast(errText(er)); } };
  $('#pg').onchange = photo; $('#pc').onchange = photo;
  $('#rp').onclick = async () => { if (!u.avatar) return; try { await store.updateProfile(u, { avatar: '' }); u.avatar = ''; viewSettings(); renderMenu(); } catch (er) { toast(errText(er)); } };
  $('#npb').onclick = async () => { const v = $('#np').value; const nm = $('#nm');
    if (v.length < 6) return say(nm, t('errShort'), false);
    try { await store.updatePassword(v); $('#np').value = ''; say(nm, t('passwordChanged'), true); } catch (e) { say(nm, errText(e), false); } };
}
function resizeAvatar(file) {
  return new Promise((ok, ko) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = 160, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
      const m = Math.min(img.width, img.height); x.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, s, s);
      URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', .8));
    };
    img.onerror = () => ko(new Error('img')); img.src = url;
  });
}

window.__mygim = S; // depuración
boot();
