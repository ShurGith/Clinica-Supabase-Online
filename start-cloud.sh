#!/usr/bin/env bash
# Arranca la clínica contra Supabase Cloud (sin Docker local).
# Uso: bash start-cloud.sh   (desde la raíz de "supabase online")
# Antes, completa las claves en .env (SUPABASE_PUBLISHABLE_KEY y SUPABASE_SECRET_KEY).
set -euo pipefail

cd "$(dirname "$0")"

# Liberar los puertos de la API (4000) y la web (5173) si quedó un arranque anterior.
for port in 4000 5173; do
  pids="$(lsof -ti:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Liberando puerto $port (proceso anterior: $pids)..."
    kill $pids 2>/dev/null || true
    sleep 1
    kill -9 $pids 2>/dev/null || true
  fi
done

if grep -v '^[[:space:]]*#' .env 2>/dev/null | grep -q "PEGA_AQUI"; then
  echo "Faltan las claves de Cloud en .env (hay valores PEGA_AQUI_...)." >&2
  echo "Copia la Publishable y la Secret desde supabase.com → Project Settings → API." >&2
  exit 1
fi

# Instalar siempre: es rápido si no hay cambios y repone dependencias que falten
# (como @alloc/quick-lru de Tailwind) aunque el lockfile no haya cambiado.
npm install

npm run build:shared
npm run build:api

# La API (puerto 4000) y la web (Vite, 5173) se levantan en segundo plano.
npm --workspace=apps/api run start &
api_pid=$!
npm run dev:web &
web_pid=$!

# ngrok es opcional: solo para que Wawp pueda llamar al webhook local.
# Si hay túnel configurado en apps/api/.env, se levanta; si no, se sigue sin él.
ngrok_pid=""
if command -v ngrok >/dev/null 2>&1; then
  ngrok_url="$(node -e 'const url=require("dotenv").config({path:"apps/api/.env"}).parsed?.WAWP_TUNNEL_URL; if (!url) process.exit(1); console.log(new URL(url).origin)' 2>/dev/null || true)"
  if [ -n "${ngrok_url:-}" ]; then
    echo "Iniciando ngrok en ${ngrok_url}..."
    ngrok http 4000 --url "$ngrok_url" --log stdout &
    ngrok_pid=$!
  fi
fi

cleanup() {
  kill "$api_pid" "$web_pid" ${ngrok_pid:+"$ngrok_pid"} 2>/dev/null || true
  wait "$api_pid" "$web_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "API en http://localhost:4000/api/v1/health — Web en http://localhost:5173"
echo "Base de datos: Supabase Cloud (wkygtnoiecafslvqaxff). Pulsa Ctrl+C para detener."
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
  sleep 1
done

wait "$api_pid" || status=$?
wait "$web_pid" || status=$?
exit "${status:-1}"
