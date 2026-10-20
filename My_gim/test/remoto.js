/* Prueba del modo remoto (API + Redis simulado): registro, guardar día, otro dispositivo, recuperar contraseña. */
const pw = (() => { try { return require('/root/rp/node_modules/playwright'); } catch { return require('playwright'); } })();
const B = 'http://localhost:8123/', ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLO ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const br = await pw.chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const mk = async () => { const c = await br.newContext({ viewport: { width: 390, height: 844 } }); const p = await c.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); return p; };
  const email = 'ana' + Date.now() + '@x.es';
  const A = await mk(); await A.goto(B); await A.waitForSelector('.auth');
  ok(!(await A.locator('.auth').innerText()).includes('Modo local'), 'modo remoto activo (sin aviso de modo local)');
  await A.click('#su'); await A.fill('[name=name]', 'Ana'); await A.fill('[name=email]', email); await A.fill('[name=password]', 'secreto1'); await A.click('#f button'); await A.waitForSelector('#view');
  await A.click('#add'); await A.fill('#fn', 'Dominadas'); await A.locator('.setrow input').nth(0).fill('0'); await A.locator('.setrow input').nth(1).fill('8'); await A.click('#fs');
  await A.click('#saveday'); await A.waitForSelector('.status.done'); ok(true, 'día guardado en el servidor');
  // duplicado
  const D = await mk(); await D.goto(B); await D.waitForSelector('.auth'); await D.click('#su'); await D.fill('[name=name]', 'X'); await D.fill('[name=email]', email.toUpperCase()); await D.fill('[name=password]', 'abcdef'); await D.click('#f button'); await D.waitForSelector('#m:not(.hidden)');
  ok((await D.locator('#m').innerText()).includes('Ya existe'), 'correo duplicado rechazado');
  // otro dispositivo
  const C = await mk(); await C.goto(B); await C.waitForSelector('.auth');
  await C.fill('[name=email]', email); await C.fill('[name=password]', 'mala'); await C.click('#f button'); await C.waitForSelector('#m:not(.hidden)');
  ok((await C.locator('#m').innerText()).includes('incorrectos'), 'contraseña errónea rechazada');
  await C.fill('[name=password]', 'secreto1'); await C.click('#f button'); await C.waitForSelector('#view');
  await C.click('#burger'); await C.click('a[href="#/progress"]'); await C.waitForSelector('.kpis');
  ok((await C.locator('.kpis').innerText()).includes('1\nEntrenos'), 'los datos aparecen en otro dispositivo');
  // recuperar contraseña
  const R = await mk(); await R.goto(B); await R.waitForSelector('.auth'); await R.click('#fg'); await R.fill('[name=email]', email); await R.click('#f button'); await R.waitForSelector('#m.ok');
  const mails = await (await fetch(B + '__mails')).json(); const link = mails.at(-1).html.match(/href="([^"]+)"/)[1].replace('https:', 'http:');
  ok(mails.at(-1).to[0] === email, 'correo de recuperación enviado: ' + link.slice(0, 40) + '…');
  const R1 = await mk(); await R1.goto(link); await R1.waitForSelector('#f'); await R1.waitForSelector('#splash',{state:'detached'}); R.close(); R.errs = R1.errs; ok((await R1.locator('.auth h1').innerText()) === 'Nueva contraseña', 'enlace abre «nueva contraseña»');
  await R1.fill('[name=password]', 'nueva123'); await R1.click('#f button');  await R1.waitForSelector('#view'); ok(true, 'contraseña cambiada y sesión iniciada');
  const R2 = await mk(); await R2.goto(link); await R2.waitForSelector('#splash',{state:'detached'}); await R2.fill('[name=password]', 'otra1234'); await R2.click('#f button'); await R2.waitForSelector('#m:not(.hidden)');
  ok((await R2.locator('#m').innerText()).includes('caducado'), 'el enlace no se puede reutilizar');
  // sesión persiste al recargar
  await A.reload(); await A.waitForSelector('#go, #view'); ok(true, 'sesión recordada tras recargar');
  const bad = await fetch(B + 'api/days', { method: 'POST', headers: { Authorization: 'Bearer x.y' } }); ok(bad.status === 401, 'API rechaza token falso');
  ok([A, C, R].every(p => !p.errs.length), 'sin errores JS');
  await br.close();
})();
