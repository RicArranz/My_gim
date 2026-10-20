// Generador mínimo de PDF (texto, A4, Helvetica estándar): sin librerías y sin red.
const W = 595.28, H = 841.89, M = 46, TOP = H - 54, BOTTOM = 54;

// Anchos de Helvetica (por mil) para ASCII 32..126; el resto de letras se estima con la media.
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
  1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
  333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const CP1252 = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '→': 0x2D };

// Texto → cadena "latin1" (cada carácter = 1 byte) válida para WinAnsiEncoding.
function enc(s) {
  let o = '';
  for (const ch of String(s).normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (/\s/.test(ch)) o += ' ';
    else if (c < 256) o += ch;
    else if (CP1252[ch] != null) o += String.fromCharCode(CP1252[ch]);
    else o += '?';
  }
  return o;
}
const esc = s => s.replace(/[\\()]/g, '\\$&');
const wOf = (s, size, bold) => { let w = 0; for (const ch of s) { const c = ch.charCodeAt(0); w += (c >= 32 && c < 127 ? HW[c - 32] : 556); } return w / 1000 * size * (bold ? 1.08 : 1); };

function wrap(text, size, bold, max) {
  const words = enc(text).split(' '), lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (cur && wOf(t, size, bold) > max) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

/* doc: { title, subtitle, lines[], days:[{ heading, exercises:[{ name, detail, note }] }] } → Uint8Array */
export function buildPDF(doc) {
  const pages = []; let ops, y;
  const newPage = () => { ops = []; pages.push(ops); y = TOP; };
  const text = (s, x, size, font, gray = 0) => ops.push(`BT /${font} ${size} Tf ${gray} g ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(s)}) Tj ET`);
  const rule = (g = 0.82) => ops.push(`${g} G 0.6 w ${M} ${(y).toFixed(2)} m ${W - M} ${(y).toFixed(2)} l S`);
  const need = h => { if (y - h < BOTTOM) newPage(); };
  const para = (str, x, size, font, bold, gray, lead) => { for (const l of wrap(str, size, bold, W - M - x)) { need(lead); y -= lead; text(l, x, size, font, gray); } };

  newPage();
  y -= 20; text(enc(doc.title), M, 20, 'F2'); y -= 8;
  for (const l of doc.lines || []) { y -= 14; text(enc(l), M, 10, 'F1', 0.35); }
  y -= 10; rule(0.5); y -= 6;

  for (const day of doc.days) {
    need(34 + 30); y -= 20;
    text(enc(day.heading), M, 12, 'F2'); y -= 5; rule(); y -= 2;
    for (const ex of day.exercises) {
      const nm = wrap(ex.name, 10.5, true, W - 2 * M - 8), det = wrap(ex.detail, 10, false, W - M - (M + 12));
      const nt = ex.note ? wrap(ex.note, 9, false, W - M - (M + 12)) : [];
      need(14 * nm.length + 13 * det.length + 12 * nt.length + 8);
      for (const l of nm) { y -= 14; text(l, M + 8, 10.5, 'F2'); }
      for (const l of det) { y -= 13; text(l, M + 12, 10, 'F1'); }
      for (const l of nt) { y -= 12; text(l, M + 12, 9, 'F3', 0.4); }
      y -= 4;
    }
  }

  // Ensamblado (todo es latin1: 1 carácter = 1 byte)
  const objs = []; const add = s => { objs.push(s); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
  const kids = [];
  pages.forEach((p, n) => {
    const foot = `BT /F1 8.5 Tf 0.5 g ${M} 30 Td (${esc(enc(doc.footer || 'My Gim'))}) Tj ET BT /F1 8.5 Tf 0.5 g ${(W - M - 30).toFixed(2)} 30 Td (${n + 1} / ${pages.length}) Tj ET`;
    const body = p.join('\n') + '\n' + foot;
    const c = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${c} 0 R >>`));
  });
  objs[1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map(k => k + ' 0 R').join(' ')}] >>`;
  const info = add(`<< /Title (${esc(enc(doc.title))}) /Producer (My Gim) >>`);

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
  return bytes;
}
