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

## Cómo funciona

- Cada ejercicio se guarda al instante **en el dispositivo**; «Guardar entrenamiento del día» lo envía a la base de datos (copia de seguridad). Los días con cambios sin enviar se avisan en rojo.
- Si sales a medias de un ejercicio, queda como borrador 30 min; al reabrir la app sale el aviso «¿seguir por donde lo dejaste?» (Sí/No).
- Se puede cambiar la fecha del día para registrar entrenamientos antiguos.
- Progreso: día / mes (calendario) / año, evolución por ejercicio (peso máximo, 1RM estimado, volumen) con % de mejora desde el inicio, más entrenados, récords, racha semanal.
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
node test/archivos.js      # importar/exportar (PDF, JSON, CSV), Lorena, arranque rápido y fallos de carga (levanta sus propios servidores)
python3 -m http.server 8125 && node test/flujo.js   # modo local, móvil 390px
```
(playwright necesario; `CHROME_PATH` opcional. El service worker exige http://localhost o https.)
