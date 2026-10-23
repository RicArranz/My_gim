// Importar / exportar entrenamientos (JSON y CSV). Sin dependencias.
//
// Formato CSV principal (el del registro de entrenamientos): UNA FILA POR GRUPO DE SERIES IGUALES
//   Fecha, Ejercicio, Nº Series, Nº Repeticiones, Peso Total / Carga [, Notas]
//   22/06/2026, Sentadilla, 4, 12, 16 kg          → 4 series de 12 repeticiones con 16 kg
// El peso puede escribirse como texto: «16 kg», «2,5 kg», «Peso corporal», «Barra + 10 kg», «8+8 kg», «35-40 kg»… (ver parseWeight).
// También se entiende el formato antiguo «una fila por serie» (fecha;ejercicio;serie;peso_kg;repeticiones;nota) y el JSON.
export const FORMAT = 'my-gim';
export const DEFAULT_BAR = 20;      // kg de la barra cuando se escribe «Barra + X kg» sin decir cuánto pesa
const MAX_DAYS = 800;

const strip = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const validDate = (y, m, d) => { const dt = new Date(y, m - 1, d); return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d; };
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const num = x => parseFloat(String(x).replace(',', '.'));

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
const toNum = v => { const n = num(String(v ?? '').replace(/kg/i, '').trim()); return isFinite(n) ? n : NaN; };

/* ---------- Peso escrito como texto ---------- */
const N = '(\\d+(?:[.,]\\d+)?)';
const re = (src, f = 'i') => new RegExp(src, f);
// Devuelve {weight, note} (note = el texto original cuando tiene información extra) o null si no hay forma de saber el peso.
//   «16 kg» → 16                       «Peso corporal», «Sin carga» → 0
//   «Barra + 10 kg» → bar + 10 (bar = 20 por defecto)      «Barra (7kg) + 5 kg» → 7 + 5
//   «… (12 kg)» al final → 12 (total exacto)               «8+8 kg» → 8 (una mancuerna por mano)      «35-40 kg» → 35 (el menor)
export function parseWeight(raw, bar = DEFAULT_BAR) {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' '); let m;
  if (!s) return { weight: 0, note: '' };
  if (/^(no especificado|n\/?a|-|—|\?)$/i.test(s)) return null;
  if (/^(peso corporal|sin (carga|peso|discos))$/i.test(s)) return { weight: 0, note: s };
  if ((m = s.match(re(`^${N} ?(kg)?$`)))) return { weight: num(m[1]), note: '' };
  if ((m = s.match(re(`\\(\\s*${N} ?kg\\s*\\)$`)))) return { weight: num(m[1]), note: s };                       // total exacto entre paréntesis
  if ((m = s.match(re(`^barra ?\\(\\s*${N} ?kg\\s*\\) ?\\+ ?${N} ?kg`)))) return { weight: num(m[1]) + num(m[2]), note: s };
  if ((m = s.match(re(`^barra ?\\+ ?${N} ?kg`)))) return { weight: bar + num(m[1]), note: s.replace(/^barra ?\+/i, `Barra ${bar} kg +`) };
  if (/^barra$/i.test(s)) return { weight: bar, note: `Barra ${bar} kg` };
  if ((m = s.match(re(`^${N} ?\\+ ?${N} ?kg`)))) return { weight: num(m[1]) === num(m[2]) ? num(m[1]) : num(m[1]) + num(m[2]), note: s };
  if ((m = s.match(re(`^${N} ?- ?${N} ?kg`)))) return { weight: Math.min(num(m[1]), num(m[2])), note: s };
  return null;
}

/* ---------- Nombres de ejercicio ---------- */
// El progreso se agrupa por nombre: «Tríceps mancuernas» y «Tríceps» deben ser lo mismo.
const ALIAS = { 'lunges maquina prensa': 'Lunges máquina', 'lunges maquina': 'Lunges máquina' };
export function normName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' '), key = strip(name); let m;
  if (ALIAS[key]) return { name: ALIAS[key], note: '' };
  if ((m = name.match(/^(.*\S) (mancuernas?)$/i))) return { name: m[1], note: 'Mancuernas' };   // «Bíceps mancuernas» → «Bíceps» + nota
  return { name, note: '' };
}

// Normaliza un ejercicio suelto (JSON); devuelve null si no sirve.
function cleanExercise(raw, errs, renames) {
  const given = String(raw?.name ?? raw?.exercise ?? raw?.ejercicio ?? '').trim().slice(0, 120), nn = normName(given);
  if (nn.name !== given && given) renames.set(given, nn.name);
  const list = raw?.sets ?? raw?.series ?? [];
  const sets = [];
  for (const s of Array.isArray(list) ? list : []) {
    const weight = toNum(s?.weight ?? s?.peso ?? s?.kg ?? 0), reps = Math.round(toNum(s?.reps ?? s?.repeticiones));
    if (weight >= 0 && weight <= 5000 && reps >= 1 && reps <= 10000) sets.push({ weight, reps }); else errs.sets++;
  }
  if (!nn.name || !sets.length) { errs.exercises++; return null; }
  const note = String(raw?.note ?? raw?.nota ?? '').trim() || nn.note;
  return { name: nn.name, sets: sets.slice(0, 60), note: note.slice(0, 200) };
}

function finish(days, errs, renames) {
  const keys = Object.keys(days).sort();
  if (keys.length > MAX_DAYS) throw new Error('tooMany');
  let exercises = 0, sets = 0;
  for (const k of keys) { if (!days[k].length) delete days[k]; else { exercises += days[k].length; days[k].forEach(i => { sets += i.sets.length; }); } }
  const ks = Object.keys(days).sort();
  if (!ks.length) throw new Error('empty');
  return { days, stats: { days: ks.length, exercises, sets, from: ks[0], to: ks[ks.length - 1] }, skipped: errs, renames: [...renames] };
}
const newErrs = () => ({ exercises: 0, sets: 0, dates: 0, blank: 0 });   // blank = filas sin datos («No especificado»): se omiten sin avisar de error

function fromJSON(data) {
  const errs = newErrs(), days = {}, renames = new Map();
  const add = (dayRaw, exRaw) => {
    const day = parseDate(dayRaw); if (!day) { errs.dates++; return; }
    const ex = cleanExercise(exRaw, errs, renames); if (ex) (days[day] ||= []).push(ex);
  };
  if (data && typeof data.days === 'object' && !Array.isArray(data.days)) {
    for (const [d, list] of Object.entries(data.days)) for (const ex of Array.isArray(list) ? list : []) add(d, ex);
  } else if (Array.isArray(data)) {
    for (const r of data) add(r?.day ?? r?.date ?? r?.fecha, r);
  } else throw new Error('format');
  return finish(days, errs, renames);
}

/* ---------- CSV ---------- */
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
// Nombres de columna (ya sin tildes ni símbolos: «Nº Series» → «n series», «Peso Total / Carga» → «peso total carga»)
const COLS = {
  date: ['fecha', 'date', 'dia', 'day'],
  name: ['ejercicio', 'exercise', 'name', 'nombre'],
  count: ['n series', 'numero series', 'num series', 'series', 'n sets', 'sets'],            // nº de series del grupo (formato agrupado)
  reps: ['n repeticiones', 'numero repeticiones', 'num repeticiones', 'repeticiones', 'reps', 'repetitions'],
  weight: ['peso total carga', 'peso total', 'peso kg', 'peso', 'carga', 'weight kg', 'weight', 'kg'],
  note: ['notas', 'nota', 'note', 'notes', 'observaciones', 'comentarios']
};

function fromCSV(text, bar) {
  const rows = csvRows(text.replace(/^﻿/, ''));
  const head = (rows[0] || []).map(strip), col = {};
  for (const [k, names] of Object.entries(COLS)) col[k] = head.findIndex(h => names.includes(h));
  if (col.date < 0 || col.name < 0 || col.reps < 0) throw new Error('format');
  if (rows.length < 2) throw new Error('empty');
  const grouped = col.count >= 0;                                  // «Nº Series» = nº de series; si no, cada fila es una serie
  const errs = newErrs(), days = {}, byKey = {}, renames = new Map();
  let lastDate = '', lastName = '';
  for (const r of rows.slice(1)) {
    const cell = k => (col[k] >= 0 ? (r[col[k]] ?? '').trim() : '');
    lastDate = cell('date') || lastDate; lastName = cell('name') || lastName;   // celdas vacías = las de la fila anterior
    const day = parseDate(lastDate); if (!day) { errs.dates++; continue; }
    const repsTxt = cell('reps'), countTxt = grouped ? cell('count') : '1';
    if (!repsTxt && !countTxt) { errs.blank++; continue; }                       // fila sin series ni repeticiones: nada que importar
    const reps = Math.round(toNum(repsTxt)), count = grouped ? Math.round(toNum(countTxt)) : 1;
    const w = grouped || cell('weight') !== '' ? parseWeight(cell('weight'), bar) : { weight: 0, note: '' };
    if (!lastName || !w || !(count >= 1 && count <= 60) || !(reps >= 1 && reps <= 10000) || !(w.weight >= 0 && w.weight <= 5000)) { errs.sets++; continue; }
    const nn = normName(lastName); if (nn.name !== lastName.trim().replace(/\s+/g, ' ')) renames.set(lastName.trim(), nn.name);
    const key = day + '|' + strip(nn.name);
    let ex = byKey[key];
    if (!ex) { ex = byKey[key] = { name: nn.name.slice(0, 120), sets: [], note: '' }; (days[day] ||= []).push(ex); }
    for (let i = 0; i < count && ex.sets.length < 60; i++) ex.sets.push({ weight: w.weight, reps });
    for (const n of [cell('note'), w.note, nn.note]) if (n && !ex.note.includes(n)) ex.note = (ex.note ? ex.note + ' · ' : '') + n;   // varias filas: se juntan las notas distintas
    ex.note = ex.note.slice(0, 200);
  }
  return finish(days, errs, renames);
}

// text: contenido del archivo; name: nombre (para decidir entre JSON y CSV).
export function parseImport(text, name = '', { bar = DEFAULT_BAR } = {}) {
  const t = text.replace(/^﻿/, '').trim();
  if (!t) throw new Error('empty');
  if (/\.json$/i.test(name) || t.startsWith('{') || t.startsWith('[')) {
    let data; try { data = JSON.parse(t); } catch { throw new Error('format'); }
    return fromJSON(data);
  }
  return fromCSV(t, bar);
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
const kg = w => String(w).replace('.', ',') + ' kg';
// Mismo formato que se importa: una fila por grupo de series iguales (se separa con «;» para que Excel en español lo abra bien).
export function toCSVText(days) {
  const out = ['Fecha;Ejercicio;Nº Series;Nº Repeticiones;Peso Total / Carga;Notas'];
  for (const [day, list] of Object.entries(days)) {
    const [y, m, d] = day.split('-');
    for (const ex of list) {
      const runs = [];
      for (const s of ex.sets) { const l = runs[runs.length - 1]; if (l && l.weight === s.weight && l.reps === s.reps) l.n++; else runs.push({ n: 1, weight: s.weight, reps: s.reps }); }
      runs.forEach((r, i) => out.push([`${d}/${m}/${y}`, q(ex.name), r.n, r.reps, kg(r.weight), i ? '' : q(ex.note)].join(';')));
    }
  }
  return '﻿' + out.join('\r\n') + '\r\n';
}
export const templateCSV = () => toCSVText({
  '2026-06-22': [{ name: 'Sentadilla', sets: [{ weight: 16, reps: 12 }, { weight: 16, reps: 12 }, { weight: 16, reps: 12 }, { weight: 16, reps: 12 }], note: '' }, { name: 'Peso muerto', sets: [{ weight: 30, reps: 12 }, { weight: 30, reps: 12 }, { weight: 30, reps: 12 }], note: '' }],
  '2026-06-27': [{ name: 'Hip thrust', sets: [{ weight: 2.5, reps: 10 }, { weight: 5, reps: 8 }], note: 'Ejemplo: dos grupos de series con distinto peso' }]
}) + '27/06/2026;Sentadilla;3;8;Barra + 10 kg;La barra suma 20 kg (total 30 kg)\r\n27/06/2026;Flexiones;3;10;Peso corporal;\r\n';
