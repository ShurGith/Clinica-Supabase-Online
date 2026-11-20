# Arrancar la aplicación contra Supabase Cloud

Esta copia (`supabase online`) trabaja **solo** con la base de datos de
Supabase Cloud. No hay Docker local de Supabase: ni `docker compose`, ni
volúmenes, ni migraciones locales que aplicar (los datos ya se migraron a
Cloud el 20/11/2026).

## 0. Claves de Cloud (una sola vez)

En el `.env` de la raíz sustituye los valores `PEGA_AQUI_...` por las claves
de supabase.com → **Project Settings → API**:

- `SUPABASE_PUBLISHABLE_KEY` y `ANON_KEY` → la **Publishable** key.
- `SUPABASE_SECRET_KEY` y `SERVICE_ROLE_KEY` → la **Secret** key.

La URL ya está puesta: `https://wkygtnoiecafslvqaxff.supabase.co`.
Wawp y el superusuario del CRM siguen en `apps/api/.env` (no se han tocado).

## 1. Arrancar todo

```bash
cd "/Users/juan/Webs/supabase online"
bash start-cloud.sh
```

- API en `http://localhost:4000` (salud: `http://localhost:4000/api/v1/health`)
- Web en `http://localhost:5173`

Si quieres arrancar por separado:

```bash
npm run build:shared
npm run dev:api    # terminal 1
npm run dev:web    # terminal 2
```

## 2. Cambios de esquema (futuras migraciones)

Los SQL de `supabase/migrations/` son la referencia del esquema. Para
aplicar un cambio nuevo en Cloud, ejecútalo en el **SQL Editor** del
dashboard de Supabase o con `psql` contra el Session pooler
(`aws-1-eu-west-1.pooler.supabase.com:5432`), nunca contra un Docker local
(que ya no existe en esta copia).

## Lo que ya no existe aquí

Se eliminó todo el stack autoalojado de Supabase (docker-compose y sus
overlays, `volumes/`, `docker/`, `dev/`, `tests/` y `utils/` de
self-hosting, `src/` de ejemplo, `setup.sh`, `run.sh`, `reset.sh`,
`update.sh`, `start-web.sh` y el `supabase.zip`). La copia original en
`/Users/juan/Webs/supabase` no se ha tocado.
