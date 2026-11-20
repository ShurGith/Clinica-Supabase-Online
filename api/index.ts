// Entry de la API para Vercel (proyecto clásico).
// Vercel convierte cada archivo bajo `api/` en una Serverless Function.
// Este archivo re-exporta la app Express de apps/api/src/app.mts.
// El `package.json` de la raíz tiene `"type": "module"`, así que el
// entry se compila como ESM y el `import` funciona.
import app from '../apps/api/src/app.mts';

export default app;
