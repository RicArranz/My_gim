#!/usr/bin/env bash
# Prepara SOLO lo que debe publicarse (sin importar/, tools/, test/, ni datos personales) en /root/My_gim_subir y /root/My_gim_subir.zip
# Uso: bash tools/empaquetar.sh   → sube el contenido de esa carpeta a GitHub (no la carpeta My_gim entera).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"; OUT=/root/My_gim_subir
rm -rf "$OUT" "$OUT.zip"; mkdir -p "$OUT"
cd "$SRC"
cp -r index.html sw.js manifest.webmanifest vercel.json package.json css js icons api "$OUT"/
rm -f "$OUT"/js/*.map
printf 'node_modules\n.vercel\n.env*\n' > "$OUT/.gitignore"
# comprobación: nada privado dentro
if grep -rIl --exclude-dir=icons -e 'lorenapoza' -e 'entrenos-lorena' "$OUT" >/dev/null 2>&1; then echo "ERROR: hay datos privados en el paquete"; grep -rIl -e 'lorenapoza' -e 'entrenos-lorena' "$OUT"; exit 1; fi
(cd "$OUT" && python3 -c "
import zipfile,os
z=zipfile.ZipFile('$OUT.zip','w',zipfile.ZIP_DEFLATED)
for r,_,fs in os.walk('.'):
    for f in fs: z.write(os.path.join(r,f))
z.close()")
echo "Listo: $OUT  y  $OUT.zip"; (cd "$OUT" && find . -type f | sort)
