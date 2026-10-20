// Importar / exportar entrenamientos (JSON y CSV). Sin dependencias.
export const FORMAT = 'my-gim';
const MAX_DAYS = 800;

const strip = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const validDate = (y, m, d) => { const dt = new Date(y, m - 1, d); return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d; };
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Acepta 2026-06-22, 22/06/2026, 22/06/26, 22-06-2026, 22.06.2026 y 22/06 (sin año = año actual).
export function parseDate(v) {
  const s = String(v ?? '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/))) { const [y, mo, d] = [+m[1], +m[2], +m[3]]; return validDate(y, mo, d) ? iso(y, mo, d) : null; }
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2}|\d{4}))?$/))) {
    const d = +m[1], mo = +m[2]; let y = m[3] ? +m[3] : new Date().getFullYear(); if (m[3] && m[3].length === 2) y += 2000;
    return validDate(y, mo, d) ? iso(y, mo, d) : null;
  }
  return null;
}
const toNum = v => { const n = parseFloat(String(v ?? '').replace(/kg/i, '').replace(',', '.').trim()); return isFinite(n) ? n : NaN; };

// Normaliza un ejercicio suelto; devuelve null si no sirve.
function cleanExercise(raw, errs) {
  const name = String(raw?.name ?? raw?.exercise ?? raw?.ejercicio ?? '').trim().slice(0, 120);
  const list = raw?.sets ?? raw?.series ?? [];
  const sets = [];
  for (const s of Array.isArray(list) ? list : []) {
    const weight = toNum(s?.weight ?? s?.peso ?? s?.kg ?? 0), reps = Math.round(toNum(s?.reps ?? s?.repeticiones));
    if (weight >= 0 && weight <= 5000 && reps >= 1 && reps <= 10000) sets.push({ weight, reps }); else errs.sets++;
  }
  if (!name || !sets.length) { errs.exercises++; return null; }
  return { name, sets: sets.slice(0, 60), note: String(raw?.note ?? raw?.nota ?? '').trim().slice(0, 200) };
}

function finish(days, errs) {
  const keys = Object.keys(days).sort();
  if (keys.length > MAX_DAYS) throw new Error('tooMany');
  let exercises = 0, sets = 0;
  for (const k of keys) { if (!days[k].length) delete days[k]; else { exercises += days[k].length; days[k].forEach(i => { sets += i.sets.length; }); } }
  const ks = Object.keys(days).sort();
  if (!ks.length) throw new Error('empty');
  return { days, stats: { days: ks.length, exercises, sets, from: ks[0], to: ks[ks.length - 1] }, skipped: errs };
}

function fromJSON(data) {
  const errs = { exercises: 0, sets: 0, dates: 0 }, days = {};
  const add = (dayRaw, exRaw) => {
    const day = parseDate(dayRaw); if (!day) { errs.dates++; return; }
    const ex = cleanExercise(exRaw, errs); if (ex) (days[day] ||= []).push(ex);
  };
  if (data && typeof data.days === 'object' && !Array.isArray(data.days)) {
    for (const [d, list] of Object.entries(data.days)) for (const ex of Array.isArray(list) ? list : []) add(d, ex);
  } else if (Array.isArray(data)) {
    for (const r of data) add(r?.day ?? r?.date ?? r?.fecha, r);
  } else throw new Error('format');
  return finish(days, errs);
}

function csvRows(text) {
  const head = text.split(/\r?\n/, 1)[0] || '';
  const delim = [';', '\t', ','].map(d => [d, head.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
const COLS = { date: ['fecha', 'date', 'dia', 'day'], name: ['ejercicio', 'exercise', 'name', 'nombre'], weight: ['peso kg', 'peso', 'weight', 'kg', 'weight kg'], reps: ['repeticiones', 'reps', 'repetitions'], note: ['nota', 'notas', 'note', 'notes'] };

function fromCSV(text) {
  const rows = csvRows(text.replace(/^\uFEFF/, ''));
  const head = (rows[0] || []).map(strip), col = {};
  for (const [k, names] of Object.entries(COLS)) col[k] = head.findIndex(h => names.includes(h));
  if (col.date < 0 || col.name < 0 || col.reps < 0) throw new Error('format');
  if (rows.length < 2) throw new Error('empty');
  const errs = { exercises: 0, sets: 0, dates: 0 }, days = {}, byKey = {};
  let lastDate = '', lastName = '';
  for (const r of rows.slice(1)) {
    const cell = k => (col[k] >= 0 ? (r[col[k]] ?? '').trim() : '');
    lastDate = cell('date') || lastDate; lastName = cell('name') || lastName;   // celdas vacías = las de la fila anterior
    const day = parseDate(lastDate); if (!day) { errs.dates++; continue; }
    const weight = cell('weight') === '' ? 0 : toNum(cell('weight')), reps = Math.round(toNum(cell('reps')));
    if (!lastName || !(weight >= 0 && weight <= 5000) || !(reps >= 1 && reps <= 10000)) { errs.sets++; continue; }
    const key = day + '|' + strip(lastName);
    let ex = byKey[key];
    if (!ex) { ex = byKey[key] = { name: lastName.slice(0, 120), sets: [], note: '' }; (days[day] ||= []).push(ex); }
    if (ex.sets.length < 60) ex.sets.push({ weight, reps });
    if (!ex.note && cell('note')) ex.note = cell('note').slice(0, 200);
  }
  return finish(days, errs);
}

// text: contenido del archivo; name: nombre (para decidir entre JSON y CSV).
export function parseImport(text, name = '') {
  const t = text.replace(/^﻿/, '').trim();
  if (!t) throw new Error('empty');
  if (/\.json$/i.test(name) || t.startsWith('{') || t.startsWith('[')) {
    let data; try { data = JSON.parse(t); } catch { throw new Error('format'); }
    return fromJSON(data);
  }
  return fromCSV(t);
}

/* ---------- Exportar ---------- */
// items: [{day, name, sets, note}] → {day: [{name, sets, note}]}
export function itemsToDays(items) {
  const days = {};
  for (const i of items) if (i.sets.length) (days[i.day] ||= []).push({ name: i.name, sets: i.sets.map(s => ({ weight: s.weight, reps: s.reps })), note: i.note || '' });
  return Object.fromEntries(Object.keys(days).sort().map(k => [k, days[k]]));
}
export const toJSONText = days => JSON.stringify({ format: FORMAT, version: 1, exported: new Date().toISOString(), days }, null, 2);

const q = v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function toCSVText(days) {
  const out = ['fecha;ejercicio;serie;peso_kg;repeticiones;nota'];
  for (const [day, list] of Object.entries(days)) {
    const [y, m, d] = day.split('-');
    for (const ex of list) ex.sets.forEach((s, n) => out.push([`${d}/${m}/${y}`, q(ex.name), n + 1, String(s.weight).replace('.', ','), s.reps, n ? '' : q(ex.note)].join(';')));
  }
  return '﻿' + out.join('\r\n') + '\r\n';
}
export const templateCSV = () => toCSVText({
  '2026-06-22': [{ name: 'Sentadilla', sets: [{ weight: 16, reps: 12 }, { weight: 16, reps: 12 }], note: 'Barra 6 kg + 10 kg' }, { name: 'Peso muerto', sets: [{ weight: 30, reps: 12 }], note: '' }],
  '2026-06-27': [{ name: 'Hip thrust', sets: [{ weight: 2.5, reps: 10 }], note: '' }]
});
