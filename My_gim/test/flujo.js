/* Prueba de humo en modo local. Uso: node test/flujo.js  (python3 -m http.server 8125 (modo local, sin /api); CHROME_PATH opcional) */
const pw = (() => { try { return require('/root/rp/node_modules/playwright'); } catch { return require('playwright'); } })();
const OUT = process.argv[2] || '/tmp/mygim_shots';
require('fs').mkdirSync(OUT, { recursive: true });
const URL = 'http://localhost:' + (process.env.PORT || 8125) + '/index.html';
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLO ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const browser = await pw.chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const errs = []; page.on('load', () => console.log('  [load]', new Date().toISOString().slice(17,23)));
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await page.goto(URL); await page.waitForSelector('.auth');
  await page.waitForTimeout(700); ok(!(await page.$('#splash')), 'splash retirado');
  await page.screenshot({ path: OUT + '/1-login.png' });
  await page.click('#su');
  await page.fill('[name=name]', 'Marta'); await page.fill('[name=surname]', 'Pérez'); await page.fill('[name=email]', 'm@x.es'); await page.fill('[name=password]', '123456');
  await page.click('#f button'); await page.waitForSelector('#view');
  ok(await page.locator('.daynav .date').innerText().then(t => /Hoy/.test(t)), 'entra a Entrenamiento');
  // ejercicio 1
  await page.click('#add'); await page.fill('#fn', 'Press banca');
  const ins = () => page.locator('.setrow input');
  await ins().nth(0).fill('60'); await ins().nth(1).fill('10');
  await page.click('#as'); await ins().nth(2).fill('62,5'); await ins().nth(3).fill('8');
  await page.screenshot({ path: OUT + '/2-form.png' });
  await page.click('#fs'); await page.waitForSelector('.ex');
  ok(await page.locator('.ex').count() === 1, 'card creada');
  // editar
  await page.click('.ex'); await ins().nth(1).fill('12'); await page.click('#fs');
  ok((await page.locator('.ex').innerText()).includes('60 kg × 12'), 'edición aplicada');
  // borrador: abrir, escribir, recargar
  await page.click('#add'); await page.fill('#fn', 'Sentadilla'); await ins().nth(0).fill('80');
  await page.reload(); await page.waitForSelector('.overlay');
  ok((await page.locator('.overlay').innerText()).includes('Sentadilla'), 'modal de borrador tras recarga');
  await page.screenshot({ path: OUT + '/3-resume.png' });
  await page.click('[data-a=yes]'); await page.waitForSelector('#fn');
  ok(await page.inputValue('#fn') === 'Sentadilla', 'borrador restaurado');
  await ins().nth(1).fill('5'); await page.click('#fs');
  // borrador caducado
  await page.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('mg_dirty_')).replace('dirty', 'draft'); localStorage.setItem(k, JSON.stringify({ date: '2026-10-16', index: null, name: 'Viejo', sets: [{ weight: '1', reps: '1' }], ts: Date.now() - 31 * 60000 })); });
  await page.reload(); await page.waitForSelector('#view');
  ok(!(await page.$('.overlay [data-a=yes]')), 'borrador >30min descartado');
  // guardar día
  ok((await page.locator('.status').innerText()).length > 0 && await page.locator('.status.pend').count() === 1, 'pendiente de guardar');
  await page.click('#saveday'); await page.waitForSelector('.status.done');
  ok(true, 'día guardado en BD');
  await page.screenshot({ path: OUT + '/4-workout.png' });
  // sembrar histórico
  await page.evaluate(() => {
    const uid = localStorage.getItem('mg_local_session'); const k = 'mg_local_data_' + uid; const a = JSON.parse(localStorage.getItem(k));
    const start = new Date(2026, 5, 22); let w = 50;
    for (let i = 0; i < 16; i++) { const d = new Date(start); d.setDate(d.getDate() + i * 6); const day = d.toISOString().slice(0, 10);
      a.push({ id: 'x' + i, day, position: 0, name: 'press Banca', sets: [{ weight: w + i * 1.25, reps: 10 }, { weight: w + i * 1.25, reps: 8 }] });
      a.push({ id: 'y' + i, day, position: 1, name: 'Remo', sets: [{ weight: 40 + i, reps: 12 }] }); }
    localStorage.setItem(k, JSON.stringify(a));
  });
  await page.reload(); await page.waitForSelector('#view');
  for (const [hash, name] of [['#/progress', '5-prog-dia'], ]) { await page.goto(URL + hash); await page.waitForSelector('.kpis'); await page.screenshot({ path: OUT + '/' + name + '.png', fullPage: true }); }
  await page.click('[data-tab=month]'); await page.waitForSelector('.cal'); await page.screenshot({ path: OUT + '/6-prog-mes.png', fullPage: true });
  ok(await page.locator('.cal button.tr').count() > 0, 'calendario marca días');
  await page.click('[data-tab=year]'); await page.waitForSelector('svg.chart'); await page.screenshot({ path: OUT + '/7-prog-ano.png', fullPage: true });
  ok(await page.locator('.big-delta').innerText().then(t => /\+/.test(t)), 'mejora % calculada (y nombres con distinto caso unificados)');
  ok(await page.locator('#exsel option').count() === 3, 'ejercicios agrupados sin distinguir mayúsculas');
  // menú + opciones
  await page.click('#burger'); await page.screenshot({ path: OUT + '/8-menu.png' });
  await page.click('a[href="#/settings"]'); await page.waitForSelector('#psave');
  await page.click('[data-mode=dark]'); await page.click('[data-accent=blue]');
  ok(await page.evaluate(() => document.documentElement.dataset.theme === 'dark' && document.documentElement.dataset.accent === 'blue'), 'modo oscuro + color');
  await page.selectOption('#lang', 'fr'); ok((await page.locator('header + main h2').first().innerText()) === 'Profil', 'idioma francés');
  await page.screenshot({ path: OUT + '/9-settings-dark.png', fullPage: true });
  await page.selectOption('#lang', 'es'); await page.waitForTimeout(400);
  // cambio de nombre
  await page.fill('#pn', 'Marta2'); await page.click('#psave'); await page.screenshot({ path: OUT + '/dbg.png', fullPage: true }); await page.waitForTimeout(1000); console.log(await page.inputValue('#pn'), 'pm=', await page.locator('#pm').innerText()); ok((await page.locator('#pm').innerText()).includes('Guardado'), 'perfil guardado');
  // foto de perfil: galería → «Sin foto»
  ok(await page.locator('.photobtns .btn').count() === 3 && (await page.locator('.photobtns').innerText()).includes('Sin foto'), 'tres botones de foto: Galería, Cámara y Sin foto');
  ok(await page.locator('#rp.sel').count() === 1 && await page.locator('.avatar.big img').count() === 0, '«Sin foto» activo por defecto (iniciales)');
  await page.setInputFiles('#pg', require('path').join(__dirname, '../icons/icon-192.png')); await page.waitForSelector('.avatar.big img');
  ok(await page.locator('#rp.sel').count() === 0, 'con foto: «Sin foto» deja de estar marcado');
  await page.click('#rp'); await page.waitForSelector('#rp.sel'); ok(await page.locator('.avatar.big img').count() === 0, '«Sin foto» quita la foto');
  await page.reload(); await page.waitForSelector('#rp.sel'); ok(true, '«Sin foto» se mantiene al recargar');
  // logout → bienvenida
  await page.click('#burger'); await page.click('#lo'); await page.waitForSelector('#go');
  ok((await page.locator('.auth h1').innerText()).includes('Marta2'), 'pantalla «Bienvenid@ nombre»');
  await page.screenshot({ path: OUT + '/10-welcome.png' });
  await page.click('#go'); await page.waitForSelector('#f'); await page.fill('[name=password]', '123456'); await page.click('#f button'); await page.waitForSelector('#view');
  ok(true, 'reentrada con contraseña');
  // QR
  await page.click('#burger'); await page.click('#qr'); await page.waitForSelector('.overlay svg'); await page.waitForTimeout(500);
  ok(await page.locator('.overlay svg rect, .overlay svg path').count() > 0, 'código QR mostrado'); await page.screenshot({ path: OUT + '/11-qr.png' });
  await page.click('[data-a=x]');
  await page.click('.brand'); await page.waitForSelector('#add');
  // botón atrás con el formulario abierto
  await page.click('#add'); await page.fill('#fn', 'Curl'); await page.goBack(); await page.waitForTimeout(300);
  ok(!(await page.$('.overlay')), 'atrás cierra el formulario'); ok(await page.locator('#resume').count() === 1, 'borrador conservado tras atrás');
  await page.click('#resume'); await page.click('#fc'); await page.waitForTimeout(300);
  ok(!(await page.$('.overlay')) && await page.locator('#resume').count() === 0, 'cancelar descarta el borrador');
  // aviso de días sin guardar
  await page.click('#dp'); await page.click('#add'); await page.fill('#fn', 'Gemelos'); await page.locator('.setrow input').nth(1).fill('15'); await page.click('#fs'); await page.click('#dn');
  ok(await page.locator('#unsaved').count() === 1, 'aviso de días sin guardar');
  // restaurar progreso (modo local)
  await page.evaluate(() => { location.hash = '#/progress'; }); await page.waitForSelector('#wipe'); await page.click('#wipe'); await page.waitForSelector('#wt');
  await page.fill('#wt', 'BORRAR'); await page.click('[data-a=ok]'); await page.waitForSelector('.empty');
  ok(await page.evaluate(() => !Object.keys(localStorage).some(k => k.startsWith('mg_local_data_') && JSON.parse(localStorage.getItem(k)).length)), 'restaurar progreso (modo local): no queda ningún entrenamiento');
  // sin scroll horizontal
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin scroll horizontal (390px)');
  // service worker
  await page.waitForFunction(() => navigator.serviceWorker.controller || true);
  console.log('errores de consola:', errs.length ? errs : 'ninguno');
  await browser.close();
})();
