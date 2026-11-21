# Repository instructions

## Project scope and sources of truth

Clínica Dental Eugenia is a Spanish-language dental appointment, patient CRM,
and WhatsApp application. Use **Paciente**, never "cliente". No economic modules
are allowed: payments, subscriptions, invoices, budgets, prices, discounts,
carts, orders, and refunds are excluded from UI, API, and database.

Read `PRODUCT.md` for product constraints and `DESIGN.md` for UI rules.
`INSTRUCCIONES.md` describes this **Supabase Cloud-only** checkout and supersedes
the Docker/self-hosting setup in `README.md` and `docs/DEPLOYMENT_GUIDE.md`.
Check current source when older docs disagree: CRM login is implemented, and
WhatsApp mode is controlled by `WAWP_DRIVER`, not `WAWP_SANDBOX_MODE`.

## Build, run, and test

Use npm workspaces from the repository root (Node.js 20+; 22+ is documented).
Install dependencies with `npm ci` on a fresh checkout. Build shared first:
`@clinica-eugenia/shared` exports compiled `dist/` files, not TypeScript source.

```bash
npm run build:shared
npm run build:api
npm run build:web
```

API and web builds include TypeScript checks. Run the compiled API and Vite in
separate terminals:

```bash
npm --workspace=apps/api run start   # API :4000; /api/v1/health
npm run dev:web                     # web :5173; proxies /api to :4000
npm run dev:mobile                  # Expo
```

`npm run dev:api` uses `node --watch --loader ts-node/esm`; `ts-node` is not
declared in the API manifest, so the compiled startup above is the reliable
alternative. Root `npm run dev` uses `&&`, not concurrent execution.
`bash start-cloud.sh` installs dependencies, builds shared/API, starts API/web
and optionally ngrok, but **first kills processes on ports 4000 and 5173**.
Do not run it blindly in a shared environment.

Tests use Node's built-in runner and import compiled API/shared output:

```bash
npm run build:shared
npm test                           # builds API, then runs tests/*.test.js

# Single file, or single test by name (rebuild API after source changes):
npm run build:api
node --test apps/api/tests/wawp.helpers.test.js
node --test --test-name-pattern='normalizes international phone numbers' apps/api/tests/wawp.helpers.test.js
```

`wawp.helpers.test.js` tests pure helpers. `clinicHours.test.js` tests time
validation but imports runtime configuration. `api.test.js` calls Wawp sending
and incoming-webhook handlers, which can read/write the configured database
even in sandbox. Review configuration before running the full suite against
Cloud; setting a shell variable alone may not override root `.env`.

## Architecture and data flow

- **Shared contracts:** `packages/shared/src/` exports Zod schemas, DTO types,
  status labels/colors, and constants through `@clinica-eugenia/shared`. Changes
  to appointment states must stay consistent across types, schemas, constants,
  database enums, and calendar rendering; `in_progress` is a real state.
- **API:** `apps/api/src/app.ts` composes Express routers under `/api/v1`
  and exports the app without listening. `server.ts` starts the local server
  and a ten-minute reminder interval. Controllers validate inputs and call
  services; some smaller modules query Supabase directly in controllers.
- **Web:** React/Vite/Tailwind 3.4, with FullCalendar for the CRM agenda.
  `App.tsx` implements public/CRM navigation using History API and Spanish
  `/crm/...` slugs, without a routing library. `src/api.ts` is the web API
  facade; it unwraps `data` and emits `crm:unauthorized` on protected API 401s.
- **Mobile:** `apps/mobile/App.tsx` is an Expo/React Native client with direct
  fetch calls and a hardcoded API base URL. Check device reachability and
  authentication when changing protected mobile flows.
- **Deployment:** `vercel.json` builds shared/web, routes `/api/*` through
  `api/index.ts` to the Express app, and falls back to `index.html` for SPA
  routes. The local server's reminder interval does not run in that entry point.

Public booking validates shared schemas, finds/creates the patient, records
consents, and delegates appointment creation. Availability intersects clinic
and professional hours, breaks, leave, existing appointments, blocked slots,
and cleanup buffer. Appointment services validate opening hours and reject
starts more than three hours in the past. PostgreSQL's
`check_appointment_overlap` trigger checks professional, operatory, and blocked
slot conflicts; preserve the `CONFLICT_*` messages mapped to HTTP 409 by the
error handler. The web calendar translates those codes into Spanish notices in
`readableAppointmentError` (`CrmCalendar.tsx`); update it if codes change.
Status history is also maintained by a database trigger.

There is no lint script; `npm run build:api` and `npm run build:web` (both run
`tsc`) are the type checks.

## API, authentication, and database conventions

- TypeScript uses ESM; relative imports use `.js` even in `.ts`/`.tsx` source.
  Edit source, not generated `dist/` files (some build output is tracked).
- API payload/database fields generally use `snake_case`; service inputs often
  use `camelCase`, mapped explicitly in controllers. Responses normally use
  `{ success: true, data }`; errors use `{ success: false, error, message }`.
  Pass controller errors to `next(err)`; custom errors carry `status` and
  `code`. Keep Zod error detection compatible with multiple workspace copies
  of Zod, not only `instanceof ZodError`.
- The active CRM gate is `requireCrmSession` in `modules/auth/auth.controller.ts`,
  mounted on all `/api` routes. Public endpoints require explicit method/path
  allowlisting in `PUBLIC_ROUTES`. Wawp webhooks instead verify their secret.
  CRM uses a signed, 12-hour HttpOnly cookie (`crm_session`, path `/api`), with
  credentials from `SUPER_USER`/`SUPER_PASS` or `crm_credentials` in Cloud.
  The separate Bearer-token `middleware/auth.ts` is not the global CRM gate.
- `config/index.ts` creates the backend-only `supabaseAdmin`, which bypasses
  RLS. Keep authorization at API boundaries; do not assume database RLS
  restricts admin-client queries. Scope clinic data with `config.clinicId`
  (`DEFAULT_CLINIC_ID` environment variable).
- Root `.env` overrides workspace `.env` values in API configuration.
  `SERVICE_ROLE_KEY`/`ANON_KEY` take precedence over their
  `SUPABASE_SECRET_KEY`/`SUPABASE_PUBLISHABLE_KEY` aliases. Keep secret/service
  keys server-side. Auth also rereads root superuser credentials.
- SQL in `supabase/migrations/` is the checked-in schema reference, but Cloud
  has runtime dependencies such as `crm_credentials` not defined there.
  Verify the deployed schema before assuming these files recreate it fully.
  Apply approved schema changes to Cloud through SQL Editor or the Session
  pooler, as described in `INSTRUCCIONES.md`. Root `db:migrate`/`db:seed` point
  to missing scripts; do not use them as a migration workflow.

## WhatsApp and scheduling conventions

Appointment/reminder notifications use `whatsappProvider`, implemented by
`WawpService`; WhatsApp routes also use `wawpService` directly. Templates live
in `message_templates` and substitute `{{nombre}}`, `{{fecha}}`, etc.
Incoming affirmative replies can confirm appointments; webhook event claims
and provider message IDs support deduplication.

`WAWP_DRIVER=sandbox|api` selects simulated or real sending. Sandbox still
archives messages in Supabase. Preserve `PROD_MOD_VERCEL=true` guards on
configuration changes and **all** outgoing WhatsApp paths, including automatic
notifications. With the real driver, `MODO_DEV=true` permits only
`PHONE_NUMBER_DEV`; an invalid/missing test number blocks all real sends.

Use `WAWP_APP_TIMEZONE` (default `Europe/Madrid`) for clinic-facing times,
Spanish date formatting, and daylight-saving-aware validation. Weekly schedules
use Sunday = 0. Preserve ISO timestamps with timezone information.

## UI and product conventions

Clinic contact details and public identity come from the API, not duplicated
constants. Use `useClinicInfo`/`loadClinicInfo(true)` and
`useSiteIdentity`/`loadSiteIdentity(true)` to share cached values and refresh
subscribers after settings changes.

Use Tailwind `brand-*` utilities backed by `--brand-*` CSS variables generated
in `brandTheme.ts`; never hardcode teal branding. Reserve emerald for WhatsApp
and success. Follow `DESIGN.md`: Plus Jakarta Sans, dense CRM typography,
border-first cards, rounded controls, and internally scrolling fixed-height
panels. Use `useNoticeModal` for web notices/confirmations, with destructive
confirmation focused on Cancelar. Target WCAG 2.1 AA.

Preserve RGPD consent and anonymization flows. Do not invent testimonials,
ratings, patient counts, awards, or experience claims; `PRODUCT.md` identifies
the existing testimonial content as unverified.
