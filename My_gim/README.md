# My Gim

PWA para registrar entrenamientos de gimnasio (peso, series y repeticiones por ejercicio y día) y ver el progreso.
Estática (HTML + CSS + JS modular, sin build), pensada para móvil y ordenador. Idiomas: castellano (por defecto), gallego, inglés, portugués, italiano, francés y alemán.

## Puesta en marcha (todo desde Vercel, sin Supabase)

Los datos viven en una base de datos **Redis (Upstash)** conectada a tu proyecto de Vercel y asociados a la cuenta (correo + contraseña). La API son funciones de Vercel en [api/](api/) (sin dependencias).

1. Sube la carpeta a GitHub e impórtala en Vercel (proyecto estático, sin build).
2. En el proyecto de Vercel → **Storage** (Marketplace) → añade **Upstash Redis** (plan gratuito) y conéctalo al proyecto. Vercel crea solo `KV_REST_API_URL` y `KV_REST_API_TOKEN`.
3. En **Settings → Environment Variables** añade:
   - `AUTH_SECRET`: una cadena larga aleatoria (p. ej. `openssl rand -hex 32`). Firma las sesiones.
   - `RESEND_API_KEY`: clave de resend.com (gratis) para enviar el correo de «recuperar contraseña».
   - `MAIL_FROM` (opcional): remitente, p. ej. `My Gim <avisos@tudominio.com>`. Sin dominio verificado, Resend solo permite enviar a tu propio correo (con `onboarding@resend.dev`).
   - `APP_URL` (opcional): URL de la app si quieres forzar la del enlace del correo.
4. Redespliega. Sin esas variables la app arranca en **modo local** (datos solo en ese dispositivo, sin recuperación por correo).

La cuenta se puede usar en cualquier dispositivo: los entrenos guardados con «Guardar entrenamiento del día» aparecen en todos.


## Publicar sin filtrar datos privados
- **No subas la carpeta `My_gim` entera.** Contiene `importar/` (datos de Lorena), `tools/` y `test/`, que no deben publicarse (Vercel sirve como archivos públicos todo lo que haya en el repositorio, aunque exista `.vercelignore`).
- Ejecuta `bash tools/empaquetar.sh`: crea `/root/My_gim_subir` (y `.zip`) con **solo** lo necesario (`index.html`, `sw.js`, `manifest`, `vercel.json`, `package.json`, `css/`, `js/`, `icons/`, `api/`) y comprueba que no hay datos privados. Sube el contenido de esa carpeta a GitHub.
- `vercel.json` además redirige `/importar/`, `/tools/` y `/test/` a la portada por si algún día se cuelan.
- Comprobación tras desplegar: `curl -I https://TU-APP.vercel.app/importar/entrenos-lorena.json` debe devolver 307/404, nunca 200.

## Correo de recuperar contraseña
Variables de Vercel (basta una de las dos opciones):
- **Brevo:** `BREVO_API_KEY` + `MAIL_FROM` (remitente verificado en Brevo, p. ej. `My Gim <avisos@cip-formacion.com>`). 300 correos/día gratis, sin límite de destinatarios.
- **Resend:** `RESEND_API_KEY` (+ `MAIL_FROM` si hay dominio verificado). 100/día y 3000/mes gratis; **sin dominio verificado solo envía a la dirección de la cuenta de Resend**.
- `GET /api/ping` indica `"mail": true|false`. Si falta el proveedor, la app dice «El envío de correos no está configurado».
- **Sin correo (recuperación manual):** Upstash → Data Browser → `email:<correo>` → copia el valor (id) → `node tools/enlace-recuperacion.mjs <id> https://tu-app.vercel.app` → pega en Upstash → CLI la línea `SET reset:…` que imprime y envía el enlace (1 hora, un solo uso).

## Seguridad y varios dispositivos
- Límites: 5 registros por hora y por IP, 60 intentos de login por IP cada 10 min, 10 por correo cada 10 min, 5 «olvidé contraseña» por correo/hora. Cambiar el correo exige la contraseña actual.
- **Copia automática** (Opciones, activada por defecto con servidor): los días con cambios se envían solos ~20 s después del último cambio, al salir de la app y al recuperar la conexión. Se puede desactivar.
- **Conflictos:** cada día lleva una versión; si otro dispositivo lo cambió, la app avisa y deja elegir entre la del servidor y la de este dispositivo. Al volver a la app se traen los cambios de otros dispositivos.
- Límites de los planes gratuitos (revisar en cada web): Upstash 256 MB y 500 000 comandos/mes; Vercel Hobby uso no comercial; Resend 100/día; Brevo 300/día.

## Cómo funciona

- Cada ejercicio se guarda al instante **en el dispositivo**; «Guardar entrenamiento del día» lo envía a la base de datos (copia de seguridad). Los días con cambios sin enviar se avisan en rojo.
- Si sales a medias de un ejercicio, queda como borrador 30 min; al reabrir la app sale el aviso «¿seguir por donde lo dejaste?» (Sí/No).
- Se puede cambiar la fecha del día para registrar entrenamientos antiguos.
- Progreso: día / mes (calendario) / año, evolución por ejercicio (peso máximo, 1RM estimado, volumen) con % de mejora desde el inicio, más entrenados, récords, racha semanal.
- **Restaurar progreso** (al final de Progreso): borra todos los entrenamientos de la cuenta (servidor y dispositivo, incluidos los días sin guardar) para empezar de cero. Ofrece descargar una copia `.json` antes y exige escribir una palabra (BORRAR) para confirmar. La cuenta, la foto y los ajustes no se tocan. API: `reset-progress`.
- **Subir archivos** (menú): importar entrenamientos desde un `.json` o `.csv` (cada día del archivo se coloca en su fecha y sustituye a lo que hubiera ese día; antes de importar muestra un resumen y avisa de los días que se reemplazan) y exportar a **PDF**, copia `.json` o Excel `.csv`, con rango de fechas. Formato CSV (separador `;` o `,`, fechas `dd/mm/aaaa`; si falta el año se usa el actual): `fecha;ejercicio;serie;peso_kg;repeticiones;nota`, una fila por serie. Hay una plantilla descargable en la propia pantalla.
- **Archivo de Lorena:** `node tools/make-import.mjs` genera `importar/entrenos-lorena.json` y `.csv` a partir de `tools/datos-lorena.cjs`. Se sube a mano desde «Subir archivos»; no hay carga automática de ningún usuario. `importar/` y `tools/datos-lorena.cjs` están en `.gitignore` (datos personales).
- **Arranque:** si ya habías entrado antes, la app abre al instante con la copia del dispositivo y comprueba la sesión y los datos en segundo plano. Si el servidor falla se avisa (botón «Reintentar»); si el dominio no tiene las variables configuradas o la API no responde, sale un mensaje que dice qué falta en vez de caer en silencio al modo local.
- Código QR: en el menú, «Código QR» muestra el QR de la app (con copiar/compartir enlace). Para imprimirlo: `node tools/qr.js https://tu-app.vercel.app qr/qr-mygim.svg`.
- Atrás del móvil con un ejercicio abierto: lo cierra y deja el borrador. Si hay otros días sin guardar en la copia de seguridad, avisa arriba.
- Instalación: aviso al cargar en el navegador y botón «Instalar app» en el menú hasta que se instale (en iPhone muestra cómo hacerlo desde Compartir).
- Actualizaciones: el service worker ([sw.js](sw.js)) pide siempre primero a la red y se recarga solo cuando hay una versión nueva, así que basta con desplegar en Vercel. Sin conexión usa la última copia cacheada.

## Archivos

`index.html` · `css/styles.css` · `js/app.js` (UI) · `js/store.js` (cliente de la API / modo local) · `js/stats.js` · `js/i18n.js` · `sw.js` · `manifest.webmanifest` · `icons/` · `api/` · `test/`

## Probar en local

```
node test/server.js        # estáticos + API real con Redis y correo simulados → http://localhost:8123
node test/remoto.js        # registro, guardar, otro dispositivo, recuperar contraseña
node test/seguridad.js     # límites, correo (Brevo/Resend/sin configurar), conflictos, copia automática, PDF y 6 tamaños de pantalla (4 servidores propios)
node test/archivos.js      # importar/exportar (PDF, JSON, CSV), Lorena, arranque rápido y fallos de carga (levanta sus propios servidores)
python3 -m http.server 8125 && node test/flujo.js   # modo local, móvil 390px
```
(playwright necesario; `CHROME_PATH` opcional. El service worker exige http://localhost o https.)
