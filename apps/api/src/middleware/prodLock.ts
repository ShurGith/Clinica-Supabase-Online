import { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';

// Bloqueo de producción (Vercel): con PROD_MOD_VERCEL=true, la Configuración
// no se puede cambiar y no puede salir ningún WhatsApp. El bloqueo se aplica
// en el backend, así que ni llamando a la API directamente se puede saltar.

/** Bloquea los cambios de la sección Configuración (ajustes, contacto, horario, acceso). */
export function blockSettingsChanges(_req: Request, res: Response, next: NextFunction) {
  if (!config.prodModVercel) return next();
  return res.status(403).json({
    success: false,
    error: 'PROD_MOD_LOCKED',
    message: 'Los ajustes están bloqueados en este despliegue (PROD_MOD_VERCEL=true): no se pueden cambiar.',
  });
}

/** Bloquea cualquier envío de WhatsApp (manual, recordatorios, avisos de citas). */
export function blockWhatsAppSending(_req: Request, res: Response, next: NextFunction) {
  if (!config.prodModVercel) return next();
  return res.status(403).json({
    success: false,
    error: 'WHATSAPP_DISABLED',
    message: 'El envío de WhatsApp está deshabilitado en este despliegue (PROD_MOD_VERCEL=true).',
  });
}
