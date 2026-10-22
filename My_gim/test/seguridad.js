/* Seguridad, correo, conflictos entre dispositivos, copia automática, PDF y diseño responsive.
   Uso: node test/seguridad.js   (levanta 4 servidores propios en :8150-8153; necesita playwright y poppler: pdftotext) */
const pw = (() => { try { return require('/root/rp/node_modules/playwright'); } catch { return require('playwright'); } })();
const { spawn, execFileSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mygim-seg-'));
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLO ') + m); if (!c) process.exitCode = 1; };
const srv = (port, env = {}) => spawn('node', [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT: port, REDIS_PORT: port + 10, ...env }, stdio: 'ignore' });
const U = p => `http://localhost:${p}/`;
const A = U(8150), B = U(8151), C = U(8152), D = U(8153);
const call = async (base, action, body, token) => {
  const r = await fetch(base + 'api/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body || {}) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
const signup = (base, email, name = 'Test', password = 'secreto1') => call(base, 'signup', { email, name, surname: '', password });
const ex = (name, w = 20, reps = 10) => ({ id: 'id-' + name, name, sets: [{ weight: w, reps }] });

(async () => {
  const servers = [
    srv(8150),                                                                                          // A: Resend simulado
    srv(8151, { RL_SIGNUP_MAX: '3', RL_LOGIN_IP_MAX: '4', RESEND_API_KEY: '', BREVO_API_KEY: 'brevo-key', MAIL_FROM: 'My Gim <avisos@cip-formacion.com>' }),   // B: Brevo + límites bajos
    srv(8152, { RESEND_API_KEY: '' }),                                                                  // C: sin proveedor de correo
    srv(8153, { RESEND_API_URL: 'http://127.0.0.1:1/nada' })                                            // D: el proveedor rechaza / no responde
  ];
  await new Promise(r => setTimeout(r, 1500));
  const br = await pw.chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const mk = async (opts = {}) => { const c = await br.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, ...opts }); const p = await c.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); return p; };

  /* ---- 1. Límites por IP ---- */
  const r1 = []; for (let i = 0; i < 4; i++) r1.push((await signup(B, `lim${i}@x.es`)).status);
  ok(r1.join() === '200,200,200,429', 'registro: máximo por IP y hora (los 3 primeros entran, el 4.º recibe 429): ' + r1.join());
  const l1 = []; for (let i = 0; i < 5; i++) l1.push((await call(B, 'login', { email: `otro${i}@x.es`, password: 'x' })).status);
  ok(l1.slice(0, 4).every(s => s === 401) && l1[4] === 429, 'login: tras 4 intentos desde una IP (aunque cambie el correo) → 429: ' + l1.join());

  /* ---- 2. Cambiar el correo exige la contraseña ---- */
  const s2 = await signup(A, 'cambio@x.es', 'Cam'); const tk = s2.j.token;
  const e0 = await call(A, 'update-profile', { email: 'nuevo@x.es' }, tk), e1 = await call(A, 'update-profile', { email: 'nuevo@x.es', currentPassword: 'mala' }, tk);
  ok(e0.status === 401 && e1.status === 401, 'cambiar el correo sin contraseña o con una errónea → 401');
  ok((await call(A, 'login', { email: 'cambio@x.es', password: 'secreto1' })).status === 200, '…y el correo antiguo sigue funcionando');
  const e2 = await call(A, 'update-profile', { email: 'Nuevo@X.es', currentPassword: 'secreto1' }, tk);
  ok(e2.status === 200 && e2.j.user.email === 'nuevo@x.es', 'con la contraseña correcta se cambia');
  ok((await call(A, 'login', { email: 'nuevo@x.es', password: 'secreto1' })).status === 200 && (await call(A, 'login', { email: 'cambio@x.es', password: 'secreto1' })).status === 401, 'login con el correo nuevo sí y con el antiguo ya no');
  ok((await call(A, 'update-profile', { name: 'Solo Nombre' }, tk)).status === 200, 'cambiar solo el nombre no pide contraseña');
  const pf = await call(A, 'update-profile', { prefs: { lang: 'en', mode: 'dark', accent: 'blue', autosync: false } }, tk);
  ok(pf.j.user.prefs.autosync === false && pf.j.user.prefs.lang === 'en', 'la preferencia de copia automática se guarda en la cuenta');

  /* ---- 3. Correo: Brevo, sin configurar y proveedor caído ---- */
  const fb = await call(B, 'forgot', { email: 'lim0@x.es' });
  const mailsB = await (await fetch(B + '__mails')).json(), mb = mailsB.at(-1) || {};
  ok(fb.status === 200 && mb._h && mb._h['api-key'] === 'brevo-key' && mb.sender && mb.sender.email === 'avisos@cip-formacion.com' && mb.to[0].email === 'lim0@x.es' && /#\/reset\//.test(mb.htmlContent || ''), 'Brevo: cabecera api-key, remitente de MAIL_FROM, destinatario y enlace de recuperación');
  const fc = await call(C, 'forgot', { email: 'cualquiera@x.es' });
  ok(fc.status === 503 && fc.j.error === 'mailconfig', 'sin proveedor de correo: error claro «mailconfig» (incluso para correos que no existen: no revela cuentas)');
  await signup(D, 'rechazo@x.es');
  const fd = await call(D, 'forgot', { email: 'rechazo@x.es' }), fe = await call(D, 'forgot', { email: 'noexiste@x.es' });
  ok(fd.status === 502 && fd.j.error === 'mail' && fe.status === 200, 'proveedor caído: «mail» para cuenta existente y OK neutro para la inexistente');
  const ping = await (await fetch(A + 'api/ping')).json(), pingC = await (await fetch(C + 'api/ping')).json();
  ok(ping.mail === true && pingC.mail === false, '/api/ping informa de si el correo está configurado (A: ' + ping.mail + ', C: ' + pingC.mail + ')');

  /* ---- 4. Versiones y conflictos al guardar un día ---- */
  const tk4 = (await signup(A, 'conf@x.es')).j.token, day = '2026-10-01';
  const sv1 = await call(A, 'save-day', { day, items: [ex('Remo')], base: '' }, tk4);
  const stale = await call(A, 'save-day', { day, items: [ex('Press')], base: '' }, tk4);
  ok(sv1.status === 200 && sv1.j.rev && stale.status === 409 && stale.j.error === 'conflict' && stale.j.items.length === 1 && stale.j.rev === sv1.j.rev, 'guardar con una versión vieja → 409 con la versión del servidor');
  const sv2 = await call(A, 'save-day', { day, items: [ex('Press')], base: sv1.j.rev }, tk4), sv3 = await call(A, 'save-day', { day, items: [ex('Gemelo')], base: 'xxxx', force: true }, tk4);
  ok(sv2.status === 200 && sv3.status === 200, 'con la versión correcta o con force se guarda');
  const dd = await call(A, 'days', {}, tk4); ok(dd.j.revs[day] === sv3.j.rev && dd.j.days[day][0].name === 'Gemelo', '/days devuelve las versiones actuales');
  ok((await call(A, 'save-day', { day: '2026-10-02', items: [ex('Nuevo')] }, tk4)).status === 200, 'clientes antiguos (sin versión) siguen pudiendo guardar');

  /* ---- 5. Recuperación sin correo (script del administrador) ---- */
  const tkR = await signup(A, 'admin-reset@x.es'); const uid = tkR.j.user.id;
  const out = execFileSync('node', [path.join(ROOT, 'tools/enlace-recuperacion.mjs'), uid, 'http://localhost:8150'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const link = out.match(/(http\S+#\/reset\/\S+)/)[1], cmd = out.match(/SET (reset:\w+) (\S+) EX 3600/);
  await fetch('http://localhost:8160/redis', { method: 'POST', body: JSON.stringify(['SET', cmd[1], cmd[2], 'EX', 3600]) });
  const rs = await call(A, 'reset', { token: link.split('/reset/')[1], password: 'nueva-clave' });
  ok(rs.status === 200 && (await call(A, 'login', { email: 'admin-reset@x.es', password: 'nueva-clave' })).status === 200, 'script de recuperación manual: el enlace permite poner nueva contraseña');
  ok((await call(A, 'reset', { token: link.split('/reset/')[1], password: 'otra-clave' })).status === 400, '…y solo sirve una vez');

  /* ---- 6. Navegador: cambio de correo con contraseña, copia automática y conflicto ---- */
  const login = async (base, email, pass = 'secreto1', init) => {
    const c = await br.newContext({ viewport: { width: 390, height: 844 } }); if (init) await c.addInitScript(init);
    const p = await c.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); await p.goto(base); await p.waitForSelector('.auth'); await p.waitForSelector('#splash', { state: 'detached' });
    if (await p.$('#go')) await p.click('#go');
    await p.fill('[name=email]', email); await p.fill('[name=password]', pass); await p.click('#f button'); await p.waitForSelector('#view'); return p;
  };
  const go = async (p, hash) => { await p.evaluate(h => { location.hash = h; }, hash); await p.waitForTimeout(250); };
  await signup(A, 'web@x.es', 'Web');
  const W1 = await login(A, 'web@x.es', 'secreto1', () => localStorage.setItem('mg_sync_ms', '700'));
  await go(W1, '#/settings'); await W1.waitForSelector('#pe');
  ok(await W1.locator('#pcw').isHidden(), 'ajustes: el campo «Contraseña actual» no sale mientras no se cambia el correo');
  await W1.fill('#pe', 'web2@x.es'); ok(await W1.locator('#pcw').isVisible(), '…y aparece al escribir otro correo');
  await W1.click('#psave'); ok((await W1.locator('#pm').innerText()).includes('contraseña actual'), 'sin contraseña no deja guardar el correo');
  await W1.fill('#pcur', 'mala'); await W1.click('#psave'); await W1.waitForSelector('#pm.err'); await W1.waitForTimeout(300); ok((await W1.locator('#pm').innerText()).includes('incorrectos'), 'con contraseña errónea lo rechaza el servidor');
  await W1.fill('#pcur', 'secreto1'); await W1.click('#psave'); await W1.waitForSelector('#pm.ok'); ok(true, 'con la contraseña correcta se guarda el correo nuevo');
  ok(await W1.locator('[data-autosync]').count() === 2, 'ajustes: interruptor de copia automática (solo con servidor)');

  // copia automática: sin pulsar nada el día pasa a «Copia hecha» y aparece en el servidor
  await go(W1, '#/'); await W1.waitForSelector('#add'); await W1.click('#add'); await W1.fill('#fn', 'Łódź sentadilla'); await W1.locator('.setrow input').nth(0).fill('40'); await W1.locator('.setrow input').nth(1).fill('8'); await W1.click('#fs');
  ok(await W1.locator('.status.pend').count() === 1 && (await W1.locator('.status').innerText()).includes('solo'), 'tras guardar el ejercicio: «Se guardará solo en unos segundos»');
  await W1.waitForSelector('.status.done', { timeout: 8000 }); ok(true, 'copia automática: el día pasa solo a «Copia de seguridad hecha»');
  const srvDays = await W1.evaluate(async () => (await (await fetch('/api/days', { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem('mg_token') } })).json()).days);
  ok(Object.values(srvDays).flat().some(e => e.name === 'Łódź sentadilla'), 'el ejercicio está en el servidor sin haber pulsado «Guardar»');
  // apagar la copia automática
  await go(W1, '#/settings'); await W1.click('[data-autosync=false]'); await W1.waitForTimeout(500);
  await go(W1, '#/'); await W1.waitForSelector('#add'); await W1.click('#add'); await W1.fill('#fn', 'Manual'); await W1.locator('.setrow input').nth(1).fill('5'); await W1.click('#fs'); await W1.waitForTimeout(2500);
  ok(await W1.locator('.status.pend').count() === 1 && !(await W1.locator('.status').innerText()).includes('solo'), 'con la copia automática desactivada se queda pendiente hasta pulsar «Guardar»');
  // exportar PDF con caracteres no latinos de Europa del Este
  await W1.click('#saveday'); await W1.waitForSelector('.status.done'); await go(W1, '#/files'); await W1.waitForSelector('#xpdf');
  const [dl] = await Promise.all([W1.waitForEvent('download'), W1.click('#xpdf')]); const pf1 = path.join(TMP, 'x.pdf'); await dl.saveAs(pf1);
  ok(/Lódz sentadilla/.test(execFileSync('pdftotext', [pf1, '-'], { encoding: 'utf8' })), 'PDF: «Łódź» se transcribe como «Lódz» en vez de «?»');

  // conflicto entre dos dispositivos con la misma cuenta
  await call(A, 'signup', { email: 'dos@x.es', name: 'Dos', password: 'secreto1' });
  const tkD = (await call(A, 'login', { email: 'dos@x.es', password: 'secreto1' })).j.token;
  await call(A, 'update-profile', { prefs: { autosync: false } }, tkD);
  const P1 = await login(A, 'dos@x.es'), P2 = await login(A, 'dos@x.es');
  const addEx = async (p, name) => { await go(p, '#/'); await p.waitForSelector('#add'); await p.click('#add'); await p.fill('#fn', name); await p.locator('.setrow input').nth(0).fill('10'); await p.locator('.setrow input').nth(1).fill('10'); await p.click('#fs'); };
  await addEx(P2, 'Desde el segundo'); await P2.click('#saveday'); await P2.waitForSelector('.status.done');
  await addEx(P1, 'Desde el primero'); await P1.click('#saveday'); await P1.waitForSelector('.overlay');
  const ct = await P1.locator('.overlay').innerText(); ok(/cambió en otro dispositivo/.test(ct) && /hay 1 ejercicio\(s\)/.test(ct), 'conflicto: avisa de que el día cambió en otro dispositivo (' + ct.split('\n').filter(l => /servidor/.test(l))[0] + ')');
  await P1.screenshot({ path: '/tmp/mygim_shots/conflict.png' });
  await P1.click('[data-a=server]'); await P1.waitForSelector('.status.done');
  const t1 = await P1.locator('main').innerText(); ok(t1.includes('Desde el segundo') && !t1.includes('Desde el primero'), 'conflicto → «usar la del servidor»: se queda la del otro dispositivo');
  await addEx(P1, 'Mi versión');                                                   // sin guardar todavía…
  await addEx(P2, 'Otro del segundo'); await P2.click('#saveday'); await P2.waitForSelector('.status.done');   // …mientras el otro dispositivo vuelve a cambiar el día
  await P1.click('#saveday'); await P1.waitForSelector('.overlay'); ok(true, 'segundo conflicto detectado');
  await P1.click('[data-a=mine]'); await P1.waitForSelector('.status.done');
  const fin = await call(A, 'days', {}, tkD); ok(Object.values(fin.j.days).flat().some(e => e.name === 'Mi versión'), 'conflicto → «conservar la de este dispositivo»: queda guardada en el servidor');
  await P1.click('#saveday'); await P1.waitForTimeout(600); ok(await P1.locator('.overlay').count() === 0, 'tras resolver, guardar de nuevo no vuelve a dar conflicto');

  /* ---- 7. Recuperar contraseña desde la pantalla con el correo sin configurar ---- */
  const P3 = await mk(); await P3.goto(C); await P3.waitForSelector('.auth'); await P3.waitForSelector('#splash', { state: 'detached' });
  await P3.click('#su'); await P3.fill('[name=name]', 'C'); await P3.fill('[name=email]', 'c@x.es'); await P3.fill('[name=password]', 'secreto1'); await P3.click('#f button'); await P3.waitForSelector('#view');
  await P3.click('#burger'); await P3.click('#lo'); await P3.waitForSelector('#go, #f'); if (await P3.$('#go')) await P3.click('#fg'); else await P3.click('#fg');
  await P3.fill('[name=email]', 'c@x.es'); await P3.click('#f button'); await P3.waitForSelector('#m.err');
  ok((await P3.locator('#m').innerText()).includes('no está configurado'), 'pantalla de recuperar contraseña: «El envío de correos no está configurado…»');

  /* ---- 8. Diseño responsive en varios tamaños ---- */
  const R = await login(A, 'web2@x.es'); const widths = [[320, 640], [360, 740], [390, 844], [414, 896], [768, 1024], [1280, 800]];
  const hs = ['#/', '#/progress', '#/settings', '#/files']; const bad = [];
  const imp = JSON.parse(fs.readFileSync(path.join(ROOT, 'importar/entrenos-lorena.json'), 'utf8')).days;
  await call(A, 'import-days', { days: imp }, (await call(A, 'login', { email: 'web2@x.es', password: 'secreto1' })).j.token);
  await R.reload(); await R.waitForSelector('#view');
  for (const [w, h] of widths) {
    await R.setViewportSize({ width: w, height: h });
    for (const hh of hs) { await go(R, hh); await R.waitForTimeout(300); const sw = await R.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); if (sw[0] > sw[1]) bad.push(`${w}px ${hh}: ${sw[0]}>${sw[1]}`); }
    if (w === 320 || w === 1280) { await go(R, '#/progress'); await R.waitForTimeout(300); await R.screenshot({ path: `/tmp/mygim_shots/resp-${w}.png`, fullPage: true }); }
  }
  ok(!bad.length, 'sin scroll horizontal en 320, 360, 390, 414, 768 y 1280 px en las 4 pantallas' + (bad.length ? ': ' + bad.join(' | ') : ''));

  ok([W1, P1, P2, P3, R].every(p => !p.errs.length), 'sin errores JS: ' + JSON.stringify([W1, P1, P2, P3, R].map(p => p.errs)));
  await br.close(); servers.forEach(s => s.kill());
})().catch(e => { console.error(e); process.exitCode = 1; process.exit(1); });
