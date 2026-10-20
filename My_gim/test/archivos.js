/* Importar/exportar, cuenta de Lorena, arranque rápido y fallos de carga.
   Uso: node test/archivos.js   (arranca sus propios servidores en :8130/:8131; necesita playwright, pdftotext y python3 con pypdf) */
const pw = (() => { try { return require('/root/rp/node_modules/playwright'); } catch { return require('playwright'); } })();
const { spawn, execFileSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mygim-'));
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLO ') + m); if (!c) process.exitCode = 1; };
const srv = (port, redis, env = {}) => spawn('node', [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT: port, REDIS_PORT: redis, ...env }, stdio: 'ignore' });
const A = 'http://localhost:8130/', JSON_FILE = path.join(ROOT, 'importar/entrenos-lorena.json'), CSV_FILE = path.join(ROOT, 'importar/entrenos-lorena.csv');

(async () => {
  const servers = [srv(8130, 8140), srv(8131, 8141, { NO_CONFIG: '1' })];
  await new Promise(r => setTimeout(r, 1200));
  const br = await pw.chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const mk = async (opts = {}) => { const c = await br.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, ...opts }); const p = await c.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); return p; };
  const reg = async (name, mail, base = A) => {
    const p = await mk(); await p.goto(base); await p.waitForSelector('.auth'); await p.waitForSelector('#splash', { state: 'detached' });
    await p.click('#su'); await p.fill('[name=name]', name); await p.fill('[name=email]', mail); await p.fill('[name=password]', 'secreto1'); await p.click('#f button'); await p.waitForSelector('#view'); return p;
  };
  const go = async (p, hash) => { await p.evaluate(h => { location.hash = h; }, hash); await p.waitForTimeout(250); };

  /* ---- Importar JSON ---- */
  const P = await reg('Ana', 'ana@x.es');
  await go(P, '#/files'); await P.waitForSelector('#imp', { state: 'attached' });
  await P.setInputFiles('#imp', JSON_FILE); await P.waitForSelector('.overlay');
  const prev = await P.locator('.overlay').innerText();
  ok(/24 días · 71 ejercicios · 222 series · del 22\/06\/26 al 10\/10\/26/.test(prev), 'vista previa de la importación: ' + prev.split('\n').filter(l => /días/.test(l))[0]);
  await P.screenshot({ path: '/tmp/mygim_shots/imp-preview.png' });
  await P.click('[data-a=ok]'); await P.waitForSelector('#im.ok');
  ok((await P.locator('#im').innerText()).includes('Importados 24 días (71 ejercicios)'), 'importación hecha');
  await go(P, '#/progress'); await P.waitForSelector('.kpis');
  ok(/^24\nEntrenos\n222\nSeries/.test(await P.locator('.kpis').innerText()), 'progreso: 24 entrenos y 222 series en sus fechas');
  await go(P, '#/'); await P.waitForSelector('#dd'); await P.fill('#dd', '2026-10-10');
  ok(await P.locator('.ex').count() === 7, 'el 10/10/26 tiene sus 7 ejercicios');
  await P.fill('#dd', '2026-06-22'); ok((await P.locator('.ex').first().innerText()).includes('Sentadilla') && (await P.locator('.ex').first().innerText()).includes('16 kg × 12'), 'el 22/06/26 tiene su sentadilla 4x12 con 16 kg');
  // otra sesión (otro dispositivo) ve lo importado
  await P.reload(); await P.waitForSelector('#view');

  /* ---- Reimportar: avisa de que reemplaza ---- */
  await go(P, '#/files'); await P.setInputFiles('#imp', JSON_FILE); await P.waitForSelector('.overlay');
  ok((await P.locator('.overlay').innerText()).includes('24 de esos días ya tienen datos'), 'avisa de que se reemplazan los días existentes');
  await P.click('[data-a=no]');

  /* ---- Archivos malos ---- */
  const bad = (name, body) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(body) });
  await P.setInputFiles('#imp', bad('mal.txt', 'hola mundo')); await P.waitForSelector('#im.err'); ok((await P.locator('#im').innerText()).includes('No reconozco'), 'archivo sin formato: «' + (await P.locator('#im').innerText()).slice(0, 60) + '…»');
  await P.setInputFiles('#imp', bad('v.csv', 'fecha;ejercicio;peso;repeticiones\n')); await P.waitForSelector('#im.err'); ok((await P.locator('#im').innerText()).includes('no contiene'), 'CSV sin filas rechazado');
  await P.setInputFiles('#imp', bad('x.csv', 'fecha;ejercicio;serie;peso_kg;repeticiones;nota\n31/02/2026;Mal;1;10;10;\n01/07/2026;Remo;1;20;12;\n01/07/2026;Remo;2;20,5;10;ok\n,;;;;;')); await P.waitForSelector('.overlay');
  const t2 = await P.locator('.overlay').innerText(); ok(/1 días · 1 ejercicios · 2 series/.test(t2) && /ignoraron/.test(t2), 'CSV a mano: fecha imposible ignorada, lo demás entra');
  await P.click('[data-a=no]');

  /* ---- Exportar: PDF, JSON y CSV ---- */
  const dl = async sel => { const [d] = await Promise.all([P.waitForEvent('download'), P.click(sel)]); const f = path.join(TMP, d.suggestedFilename()); await d.saveAs(f); return f; };
  const pdf = await dl('#xpdf');
  ok(/^my-gim-entrenos-\d{8}\.pdf$/.test(path.basename(pdf)), 'PDF descargado: ' + path.basename(pdf));
  const head = fs.readFileSync(pdf).subarray(0, 8).toString('latin1'); ok(head.startsWith('%PDF-1.4'), 'cabecera PDF válida');
  const txt = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
  ok(['Sentadilla', 'Tríceps', 'Jalón al pecho', 'Lunges máquina', 'Lunes 22/06/26', 'Sábado 10/10/26', 'Barra 20 kg + 10 kg', '4 x 12 @ 16 kg'].every(s => txt.includes(s)), 'el texto del PDF contiene ejercicios, fechas, notas y series con tildes');
  ok(!/[�]/.test(txt), 'sin caracteres rotos');
  const info = execFileSync('python3', ['-I', '-c', 'import sys,pypdf;r=pypdf.PdfReader(sys.argv[1]);print(len(r.pages), r.pages[0].mediabox.width)', pdf], { encoding: 'utf8' }).trim();
  ok(/^\d+ 595/.test(info), 'pypdf abre el PDF (páginas y ancho A4): ' + info);
  fs.copyFileSync(pdf, '/tmp/mygim_shots/export.pdf');
  // rango: solo octubre
  await P.fill('#xf', '2026-10-01'); const pdf2 = await dl('#xpdf'); const txt2 = execFileSync('pdftotext', [pdf2, '-'], { encoding: 'utf8' });
  ok(txt2.includes('10/10/26') && !txt2.includes('22/06/26') && /3 Entrenos/i.test(txt2), 'el rango de fechas filtra el PDF');
  await P.fill('#xf', '2027-01-01'); await P.fill('#xt', '2027-02-01'); await P.click('#xpdf'); await P.waitForSelector('#xm.err'); ok(true, 'rango vacío avisa');
  await P.fill('#xf', '2026-06-22'); await P.fill('#xt', '2026-10-10');
  const exJson = await dl('#xjson'), exCsv = await dl('#xcsv');
  // lo exportado se puede volver a importar tal cual (copia de seguridad)
  for (const [f, label] of [[exJson, 'JSON'], [exCsv, 'CSV']]) {
    const Q = await reg('Bea', `bea-${label}@x.es`); await go(Q, '#/files'); await Q.setInputFiles('#imp', f); await Q.waitForSelector('.overlay');
    ok((await Q.locator('.overlay').innerText()).includes('24 días · 71 ejercicios · 222 series'), `copia ${label} exportada → importada en otra cuenta`);
    await Q.click('[data-a=ok]'); await Q.waitForSelector('#im.ok'); await Q.context().close();
  }
  const tpl = await dl('#tpl'); ok(fs.readFileSync(tpl, 'utf8').includes('fecha;ejercicio'), 'plantilla CSV descargable');
  await P.screenshot({ path: '/tmp/mygim_shots/files.png', fullPage: true });

  /* ---- Ninguna cuenta recibe datos automáticamente (la carga es siempre manual con el archivo) ---- */
  const L = await reg('Lorena', 'lorenapoza.docente@gmail.com'); await go(L, '#/progress'); await L.waitForSelector('.empty');
  ok(await L.locator('.kpis').count() === 0, 'cuenta «Lorena»: empieza vacía (sin precarga automática)');
  await go(L, '#/files'); await L.setInputFiles('#imp', JSON_FILE); await L.waitForSelector('.overlay'); await L.click('[data-a=ok]'); await L.waitForSelector('#im.ok');
  await go(L, '#/progress'); await L.waitForSelector('.kpis'); ok(/^24\nEntrenos\n222\nSeries/.test(await L.locator('.kpis').innerText()), 'importando su archivo a mano: 24 entrenos y 222 series');
  await go(L, '#/'); await L.waitForSelector('#dd'); await L.fill('#dd', '2026-07-11'); ok((await L.locator('main').innerText()).includes('30 kg × 10'), 'sentadilla del 11/07 = 30 kg (barra de 20 kg + 10)');
  // el selector de archivos no restringe tipos (en Android/iOS algunos .json/.csv aparecían deshabilitados)
  await go(L, '#/files'); await L.waitForSelector('#imp', { state: 'attached' }); ok((await L.locator('#imp').getAttribute('accept')) === null, 'selector de archivos sin filtro de tipo');

  /* ---- Arranque: abre al instante con la copia y no se cuelga ---- */
  const F = await mk(); await F.goto(A); await F.waitForSelector('.auth'); await F.waitForSelector('#splash', { state: 'detached' });
  await F.click('#su'); await F.fill('[name=name]', 'Cris'); await F.fill('[name=email]', 'cris@x.es'); await F.fill('[name=password]', 'secreto1'); await F.click('#f button'); await F.waitForSelector('#view');
  await F.click('#add'); await F.fill('#fn', 'Remo'); await F.locator('.setrow input').nth(0).fill('30'); await F.locator('.setrow input').nth(1).fill('10'); await F.click('#fs');
  await F.click('#saveday'); await F.waitForSelector('.status.done');
  await F.route('**/api/**', () => {});                                    // la API deja de responder
  const t0 = Date.now(); await F.reload(); await F.waitForSelector('.ex', { timeout: 5000 });
  ok(Date.now() - t0 < 3000 && (await F.locator('.ex').innerText()).includes('Remo'), `con la API colgada la app abre con su copia en ${Date.now() - t0} ms`);
  await F.waitForSelector('#retry', { timeout: 25000 });
  ok(await F.locator('#retry').count() === 1, 'pasado el tiempo avisa de que no pudo cargar los datos del servidor (botón Reintentar)');
  await F.screenshot({ path: '/tmp/mygim_shots/loaderr.png' });
  await F.unroute('**/api/**'); await F.click('#retry'); await F.waitForSelector('#retry', { state: 'detached' }); ok(true, 'Reintentar recupera los datos');
  // sesión caducada: vuelve al login con aviso
  await F.evaluate(() => localStorage.setItem('mg_token', 'x.y')); await F.reload(); await F.waitForSelector('.auth', { timeout: 8000 });
  ok(!(await F.$('#view')) && await F.locator('.auth').count() === 1, 'sesión inválida → pantalla de acceso');
  await F.context().close();

  /* ---- Servidor sin configurar en un dominio real: mensaje claro, no «modo local» ---- */
  const U = await mk(); await U.goto('http://127.0.0.2:8131/'); await U.waitForSelector('#retrysrv', { timeout: 15000 });
  const um = await U.locator('.auth').innerText(); ok(/KV_REST_API_URL/.test(um) && /AUTH_SECRET/.test(um) && !/Modo local/.test(um), 'sin variables: indica cuáles faltan (' + um.split('\n').filter(l => /Faltan/.test(l))[0] + ')');
  await U.screenshot({ path: '/tmp/mygim_shots/unconfigured.png' });
  const E = await mk(); await E.route('**/api/ping', r => r.fulfill({ status: 401, body: '<html>Authentication Required</html>', contentType: 'text/html' }));
  await E.goto('http://127.0.0.2:8130/'); await E.waitForSelector('#retrysrv', { timeout: 15000 }); ok((await E.locator('.auth').innerText()).includes('(401)'), 'ping 401 (p. ej. protección de Vercel): lo muestra');
  const LM = await mk(); await LM.goto('http://localhost:8131/'); await LM.waitForSelector('.auth'); await LM.waitForSelector('#splash', { state: 'detached' });
  ok(!(await LM.$('#retrysrv')) && (await LM.locator('.auth').innerText()).includes('Modo local'), 'en localhost sigue funcionando el modo local');

  ok([P, L, F].every(p => !p.errs.length), 'sin errores JS: ' + JSON.stringify([P, L, F, U, E, LM].map(p => p.errs)));
  await br.close(); servers.forEach(s => s.kill());
})().catch(e => { console.error(e); process.exitCode = 1; process.exit(1); });
