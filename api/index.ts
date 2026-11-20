// Entry de la API para Vercel (proyecto clásico).
// Vercel convierte cada archivo bajo `api/` en una Serverless Function.
// Este archivo re-exporta la app Express de apps/api/src/app.ts.
// El import usa la extensión `.js` (patrón estándar ESM+TS: se resuelve
// a `app.ts`); importar el `.mts` daba TS5097 y ERR_MODULE_NOT_FOUND.
import app from '../apps/api/src/app.js';

export default app;
