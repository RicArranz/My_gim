// Recuperación de contraseña SIN correo (para el administrador). No necesita claves ni acceso a la base de datos desde aquí:
//   1) En Upstash → Data Browser abre la clave  email:<correo>  y copia su valor (es el id del usuario).
//   2) node tools/enlace-recuperacion.mjs <id-usuario> [https://tu-app.vercel.app]
//   3) Pega en Upstash → CLI la línea «SET reset:…» que imprime y envía el enlace a la persona (caduca en 1 hora, un solo uso).
import { randomBytes, createHash } from 'crypto';
const [id, base = 'https://my-gim.vercel.app'] = process.argv.slice(2);
if (!id || !/^[0-9a-f-]{36}$/i.test(id)) { console.error('Uso: node tools/enlace-recuperacion.mjs <id-usuario (36 caracteres)> [url-de-la-app]'); process.exit(1); }
const token = randomBytes(32).toString('base64url');
const key = 'reset:' + createHash('sha256').update(token).digest('hex');
console.log(`\nEnlace para la persona (válido 1 hora, un solo uso):\n  ${base.replace(/\/$/, '')}/#/reset/${token}\n`);
console.log(`Pega esto en Upstash → CLI y pulsa Enter:\n  SET ${key} ${id} EX 3600\n`);
