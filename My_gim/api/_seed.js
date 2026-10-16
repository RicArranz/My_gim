// Datos precargados para cuentas concretas (solo en el servidor). Se aplican al REGISTRARSE con ese correo y ese nombre.
// "weight" es el peso TOTAL levantado. Si hay barra se suma su peso (20 kg si no se indicó otro) y el desglose queda en "note".
const Y = '2026-';
const r = (w, ...reps) => reps.map(n => ({ weight: w, reps: n }));         // misma carga, repeticiones por serie
const n = (count, reps, w) => Array.from({ length: count }, () => ({ weight: w, reps }));
const e = (name, sets, note) => (note ? { name, sets, note } : { name, sets });

const lorena = {
  [Y + '06-22']: [e('Sentadilla', n(4, 12, 16))],
  [Y + '06-27']: [e('Peso muerto', n(3, 12, 30))],
  [Y + '07-07']: [
    e('Hip thrust', [...n(3, 9, 2.5), ...n(1, 8, 5)], '3 series de 8-10 reps con 2,5 kg + 1 serie de 8 con 5 kg'),
    e('Tríceps', n(3, 12, 6)), e('Bíceps', n(3, 12, 5)), e('Lunges', n(3, 12, 8), '8 + 8 kg')],
  [Y + '07-11']: [
    e('Sentadilla', [...n(2, 10, 30), ...n(1, 8, 30)], 'Barra 20 kg + 10 kg'),
    e('Peso muerto', [...n(2, 10, 30), ...n(1, 5, 30)], 'Barra 20 kg + 10 kg'),
    e('Press hombro', [...n(1, 12, 12), ...n(2, 10, 16)], 'Barra 7 kg + 5 kg (1x12) y + 9 kg (2x10)')],
  [Y + '07-14']: [
    e('Hip thrust', n(4, 10, 0), 'Sin discos'), e('Tríceps', n(3, 12, 7)),
    e('Elevaciones laterales', n(2, 5, 6)), e('Bíceps', n(2, 12, 6))],
  [Y + '07-21']: [
    e('Sentadilla', [...n(2, 10, 30), ...n(2, 8, 30)], 'Barra 20 kg + 10 kg'),
    e('Peso muerto', n(4, 10, 40), 'Barra 20 kg + 20 kg'), e('Elevaciones laterales', n(3, 10, 5))],
  [Y + '07-28']: [
    e('Sentadilla', n(4, 10, 30), 'Barra 20 kg + 10 kg'), e('Tríceps', n(3, 10, 7)), e('Elevaciones laterales', n(3, 12, 4))],
  [Y + '07-30']: [e('Hip thrust', n(4, 10, 2.5)), e('Leg curl', n(3, 12, 15), '3-4 series de 12'), e('Jalón al pecho', n(3, 12, 25))],
  [Y + '08-03']: [
    e('Abductor interno', n(3, 12, 35), '35-40 kg'), e('Abductor externo', n(3, 14, 30)),
    e('Tríceps polea', n(3, 10, 12.5)), e('Press hombro', n(3, 12, 6), 'Mancuernas')],
  [Y + '08-05']: [
    e('Sentadilla', [...n(1, 6, 20), ...n(2, 12, 10), ...n(1, 12, 5)]),
    e('Peso muerto', n(4, 12, 20)), e('Flexiones', n(3, 10, 0))],
  [Y + '08-08']: [
    e('Hip thrust', n(4, 10, 5)), e('Remo', n(4, 12, 20)), e('Lunges máquina', n(4, 12, 10), 'Máquina de prensa, 12 + 12')],
  [Y + '08-11']: [e('Sentadilla', n(4, 12, 2.5), 'Buena técnica'), e('Peso muerto', n(4, 12, 20)), e('Flexiones', n(3, 12, 0))],
  [Y + '08-13']: [e('Hip thrust', [...n(3, 12, 5), ...n(1, 10, 5)])],
  [Y + '08-17']: [e('Abductor interno', n(2, 10, 25))],
  [Y + '08-28']: [
    e('Abductor externo', n(3, 12, 40)), e('Abductor interno', n(3, 10, 30)), e('Gemelo', n(3, 12, 60)),
    e('Press banca', n(3, 5, 10)), e('Tríceps', n(3, 11, 7), 'Mancuerna'), e('Bíceps', n(3, 10, 6))],
  [Y + '09-01']: [e('Peso muerto', n(4, 12, 20), 'Subir la próxima semana')],
  [Y + '09-03']: [e('Hip thrust', n(4, 12, 5)), e('Press banca', n(3, 12, 10))],
  [Y + '09-06']: [
    e('Abductor externo', n(3, 12, 45)), e('Abductor interno', n(3, 12, 30)),
    e('Lunges máquina', n(3, 10, 20), 'Máquina'), e('Press banca inclinado', n(3, 10, 10))],
  [Y + '09-10']: [e('Sentadilla', n(4, 8, 10))],
  [Y + '09-26']: [e('Hip thrust', n(3, 10, 10))],
  [Y + '09-27']: [
    e('Peso muerto', [...n(3, 12, 20), ...n(1, 12, 24)]), e('Remo espalda', n(3, 10, 30)),
    e('Jalón al pecho', n(3, 12, 25)), e('Tríceps', [...n(2, 12, 7), ...n(1, 11, 7)], 'Mancuerna')],
  [Y + '10-03']: [e('Sentadilla', r(30, 8, 8, 8), 'Barra 20 kg + 10 kg'), e('Peso muerto', r(45, 8, 8, 8), 'Barra 20 kg + 25 kg')],
  [Y + '10-04']: [
    e('Abductor interno', r(35, 8, 7)), e('Abductor externo', r(50, 8, 8)), e('Press banca', r(10, 10, 10, 10)),
    e('Jalón al pecho', r(25, 10, 10, 10)), e('Remo', r(30, 8, 8, 8)), e('Tríceps polea', r(10, 12, 12))],
  [Y + '10-10']: [
    e('Press banca', r(14, 8, 8, 5)), e('Jalón al pecho', r(30, 8, 8, 8)), e('Remo', r(30, 8, 8, 8)),
    e('Press hombro', r(6, 10, 10), 'Mancuernas'), e('Elevaciones laterales', r(6, 6, 6), 'Mancuernas'),
    e('Tríceps', r(8, 12, 11), 'Mancuernas'), e('Bíceps', r(6, 8, 9), 'Mancuernas')]
};

module.exports = { 'lorenapoza.docente@gmail.com': { name: 'lorena', days: lorena } };
