// Genera un QR (SVG) para una URL:  node tools/qr.js https://mi-app.vercel.app qr/qr-mygim.svg
const qrcode = require('../js/qrcode.js');
const [url, out = 'qr/qr-mygim.svg'] = process.argv.slice(2);
if (!url) { console.error('Uso: node tools/qr.js <url> [salida.svg]'); process.exit(1); }
const q = qrcode(0, 'M'); q.addData(url); q.make();
const svg = q.createSvgTag({ cellSize: 10, margin: 4, scalable: false }).replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
require('fs').writeFileSync(out, svg); console.log('Escrito', out);
