// Genera los archivos de importación de Lorena a partir de tools/datos-lorena.cjs (única fuente de verdad).
//   node tools/make-import.mjs        → importar/entrenos-lorena.json y .csv
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';
import { itemsToDays, toJSONText, toCSVText, parseImport } from '../js/io.js';
const require = createRequire(import.meta.url);
const lorena = require('./datos-lorena.cjs');
const items = Object.entries(lorena).flatMap(([day, list]) => list.map(i => ({ day, name: i.name, sets: i.sets, note: i.note || '' })));
const days = itemsToDays(items);
mkdirSync(new URL('../importar/', import.meta.url), { recursive: true });
writeFileSync(new URL('../importar/entrenos-lorena.json', import.meta.url), toJSONText(days));
writeFileSync(new URL('../importar/entrenos-lorena.csv', import.meta.url), toCSVText(days));
// comprobación: lo escrito se vuelve a leer igual
for (const f of ['json', 'csv']) {
  const { readFileSync } = await import('fs');
  const r = parseImport(readFileSync(new URL(`../importar/entrenos-lorena.${f}`, import.meta.url), 'utf8'), 'x.' + f);
  console.log(f, r.stats, 'ignorado:', JSON.stringify(r.skipped));
}
