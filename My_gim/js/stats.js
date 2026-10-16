// Cálculo de estadísticas a partir de [{day, name, sets:[{weight,reps}]}]
const keyOf = n => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const mondayOf = s => { const [y, m, d] = s.split('-').map(Number); const x = new Date(y, m - 1, d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); };

export function stats(items) {
  const days = new Set(), byMonth = {}, byEx = {};
  let totalSets = 0, totalVolume = 0, first = null;
  const dayVol = {};
  for (const it of items) {
    if (!it.sets.length) continue;
    days.add(it.day); if (!first || it.day < first) first = it.day;
    const v = it.sets.reduce((a, s) => a + s.weight * s.reps, 0);
    totalSets += it.sets.length; totalVolume += v;
    const mk = it.day.slice(0, 7); (byMonth[mk] ||= { sessions: 0, volume: 0, _d: new Set() });
    byMonth[mk].volume += v; byMonth[mk]._d.add(it.day);
    const k = keyOf(it.name), e = (byEx[k] ||= { name: it.name.trim(), days: {}, pr: { weight: -1, reps: 0, day: it.day } });
    const d = (e.days[it.day] ||= { day: it.day, max: 0, rm: 0, vol: 0 });
    d.vol += v;
    for (const s of it.sets) {
      d.max = Math.max(d.max, s.weight);
      d.rm = Math.max(d.rm, s.reps === 1 ? s.weight : s.weight * (1 + s.reps / 30)); // Epley
      if (s.weight > e.pr.weight || (s.weight === e.pr.weight && s.reps > e.pr.reps)) e.pr = { weight: s.weight, reps: s.reps, day: it.day };
    }
  }
  for (const m of Object.values(byMonth)) { m.sessions = m._d.size; delete m._d; }
  for (const e of Object.values(byEx)) { e.series = Object.values(e.days).sort((a, b) => a.day.localeCompare(b.day)); e.count = e.series.length; delete e.days; }
  // racha semanal: semanas consecutivas con algún entrenamiento, hasta la actual (o la anterior)
  const weeks = new Set([...days].map(mondayOf)); let streakWeeks = 0;
  let w = mondayOf(iso(new Date()));
  const back = s => { const [y, m, d] = s.split('-').map(Number); const x = new Date(y, m - 1, d - 7); return iso(x); };
  if (!weeks.has(w)) w = back(w);
  while (weeks.has(w)) { streakWeeks++; w = back(w); }
  return { sessions: days.size, totalSets, totalVolume, first, days, byMonth, byEx, streakWeeks };
}
