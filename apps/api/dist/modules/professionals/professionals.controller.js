import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin, config } from '../../config/index.js';
import { DAY_NAMES_ES } from '@clinica-eugenia/shared';
const router = Router();
// GET /api/v1/professionals - Listado de odontólogos y especialistas
router.get('/', async (req, res, next) => {
    try {
        const { serviceId } = req.query;
        let query = supabaseAdmin
            .from('professionals')
            .select(`
        id, first_name, last_name, collegiated_number, specialty,
        biography, languages, color, photo_url, default_operatory_id, sort_order,
        services:professional_services (service:services(id, name, slug))
      `)
            .eq('clinic_id', config.clinicId)
            .eq('is_active', true)
            .order('sort_order', { ascending: true });
        const { data, error } = await query;
        if (error)
            throw error;
        let list = data || [];
        if (serviceId) {
            list = list.filter((p) => p.services?.some((s) => s.service?.id === serviceId));
        }
        res.json({ success: true, data: list });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/v1/professionals/manage/all - Panel CRM: todos los profesionales (activos o no) con horario y ausencias
router.get('/manage/all', async (_req, res, next) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('professionals')
            .select('*, schedules:professional_schedules (*), time_off:professional_time_off (*)')
            .eq('clinic_id', config.clinicId)
            .order('sort_order', { ascending: true });
        if (error)
            throw error;
        res.json({ success: true, data: data || [] });
    }
    catch (err) {
        next(err);
    }
});
const professionalSchema = z.object({
    first_name: z.string().trim().min(1, 'El nombre es obligatorio.').max(100),
    last_name: z.string().trim().min(1, 'Los apellidos son obligatorios.').max(100),
    specialty: z.string().trim().min(1, 'La especialidad es obligatoria.').max(150),
    collegiated_number: z.string().trim().max(50).optional().nullable().transform(v => v || null),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color no válido.').optional(),
    is_active: z.boolean().optional(),
});
const sendValidationError = (res, error) => res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: error.issues.map(i => i.message).join(' ') });
// POST /api/v1/professionals - Alta de profesional (con horario laboral por defecto L-V 09:00-18:00)
router.post('/', async (req, res, next) => {
    try {
        const parsed = professionalSchema.safeParse(req.body);
        if (!parsed.success)
            return sendValidationError(res, parsed.error);
        const { data: last } = await supabaseAdmin
            .from('professionals').select('sort_order').eq('clinic_id', config.clinicId)
            .order('sort_order', { ascending: false }).limit(1).maybeSingle();
        // Cada profesional tiene su propio gabinete para que puedan coincidir citas en la misma hora
        let operatoryId;
        if (!operatoryId) {
            const { count } = await supabaseAdmin
                .from('operatories').select('id', { count: 'exact', head: true }).eq('clinic_id', config.clinicId);
            const { data: op, error: opError } = await supabaseAdmin
                .from('operatories')
                .insert({ clinic_id: config.clinicId, name: `Gabinete ${(count ?? 0) + 1}`, is_active: true })
                .select('id').single();
            if (opError)
                throw opError;
            operatoryId = op.id;
        }
        const { data: prof, error } = await supabaseAdmin
            .from('professionals')
            .insert({ ...parsed.data, default_operatory_id: operatoryId, clinic_id: config.clinicId, sort_order: (last?.sort_order ?? 0) + 1 })
            .select('*')
            .single();
        if (error)
            throw error;
        const { data: clinicDays } = await supabaseAdmin
            .from('clinic_schedules').select('*').eq('clinic_id', config.clinicId);
        const rows = [0, 1, 2, 3, 4, 5, 6].map(d => {
            const c = (clinicDays || []).find((x) => x.day_of_week === d);
            const open = c && !c.is_closed;
            return {
                professional_id: prof.id,
                day_of_week: d,
                start_time: c?.open_time || '09:00',
                end_time: c?.close_time || '18:00',
                break_start: open ? c.lunch_start : null,
                break_end: open ? c.lunch_end : null,
                is_working: Boolean(open),
            };
        });
        const { error: schErr } = await supabaseAdmin.from('professional_schedules').insert(rows);
        if (schErr)
            throw schErr;
        res.status(201).json({ success: true, data: prof });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/v1/professionals/:id - Editar datos del profesional (también activar/desactivar)
router.put('/:id', async (req, res, next) => {
    try {
        const parsed = professionalSchema.partial().safeParse(req.body);
        if (!parsed.success)
            return sendValidationError(res, parsed.error);
        const { data, error } = await supabaseAdmin
            .from('professionals')
            .update({ ...parsed.data, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .eq('clinic_id', config.clinicId)
            .select('*')
            .single();
        if (error)
            throw error;
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
});
const hhmm = z.string().regex(/^([01]\d|2[0-3]):(00|30)(:00)?$/, 'Las horas deben ser en tramos de 30 minutos (HH:00 o HH:30).').transform(t => t.slice(0, 5));
const optionalHhmm = z.union([hhmm, z.literal(''), z.null()]).optional().transform(t => t || null);
const profDaySchema = z.object({
    day_of_week: z.number().int().min(0).max(6),
    is_working: z.boolean(),
    start_time: hhmm,
    end_time: hhmm,
    break_start: optionalHhmm,
    break_end: optionalHhmm,
}).superRefine((d, ctx) => {
    const day = DAY_NAMES_ES[d.day_of_week];
    if (d.start_time >= d.end_time) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${day}: la entrada debe ser anterior a la salida.` });
    }
    if (!!d.break_start !== !!d.break_end) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${day}: en jornada partida indica el fin de la mañana y el inicio de la tarde.` });
    }
    else if (d.break_start && d.break_end && d.is_working
        && !(d.start_time < d.break_start && d.break_start < d.break_end && d.break_end < d.end_time)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${day}: la tarde debe empezar después de acabar la mañana (entrada < fin de mañana < inicio de tarde < salida).` });
    }
});
const profWeekSchema = z.array(profDaySchema).length(7, 'Hay que enviar los 7 días de la semana.')
    .refine(days => new Set(days.map(d => d.day_of_week)).size === 7, 'Cada día debe aparecer una sola vez.');
// PUT /api/v1/professionals/:id/schedule - Horario semanal del profesional
router.put('/:id/schedule', async (req, res, next) => {
    try {
        const parsed = profWeekSchema.safeParse(req.body?.schedules);
        if (!parsed.success)
            return sendValidationError(res, parsed.error);
        const { data: clinicDays } = await supabaseAdmin
            .from('clinic_schedules').select('day_of_week, open_time, close_time, is_closed').eq('clinic_id', config.clinicId);
        const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        for (const d of parsed.data) {
            const c = (clinicDays || []).find((x) => x.day_of_week === d.day_of_week);
            if (!c || !d.is_working)
                continue;
            if (c.is_closed) {
                return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: `El centro está cerrado los ${dayNames[d.day_of_week]}: no se puede trabajar ese día.` });
            }
            const open = String(c.open_time).slice(0, 5), close = String(c.close_time).slice(0, 5);
            if (d.start_time < open || d.end_time > close) {
                return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: `El ${dayNames[d.day_of_week]} el centro abre de ${open} a ${close}: el horario del profesional debe quedar dentro.` });
            }
        }
        const rows = parsed.data.map(d => ({
            professional_id: req.params.id,
            day_of_week: d.day_of_week,
            start_time: d.start_time,
            end_time: d.end_time,
            break_start: d.break_start,
            break_end: d.break_end,
            is_working: d.is_working,
            updated_at: new Date().toISOString(),
        }));
        const { data, error } = await supabaseAdmin
            .from('professional_schedules')
            .upsert(rows, { onConflict: 'professional_id,day_of_week' })
            .select('*')
            .order('day_of_week', { ascending: true });
        if (error)
            throw error;
        res.json({ success: true, message: 'Horario del profesional actualizado.', data });
    }
    catch (err) {
        next(err);
    }
});
const timeOffSchema = z.object({
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha de inicio no válida.'),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha de fin no válida.'),
    reason: z.string().trim().min(1, 'Indica el motivo.').max(255),
}).refine(d => d.start_date <= d.end_date, 'La fecha de inicio debe ser anterior o igual a la de fin.');
// POST /api/v1/professionals/:id/time-off - Registrar vacaciones/ausencia
router.post('/:id/time-off', async (req, res, next) => {
    try {
        const parsed = timeOffSchema.safeParse(req.body);
        if (!parsed.success)
            return sendValidationError(res, parsed.error);
        const { data, error } = await supabaseAdmin
            .from('professional_time_off')
            .insert({ ...parsed.data, professional_id: req.params.id, approved: true })
            .select('*')
            .single();
        if (error)
            throw error;
        res.status(201).json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
});
// DELETE /api/v1/professionals/:id/time-off/:timeOffId
router.delete('/:id/time-off/:timeOffId', async (req, res, next) => {
    try {
        const { error } = await supabaseAdmin
            .from('professional_time_off')
            .delete()
            .eq('id', req.params.timeOffId)
            .eq('professional_id', req.params.id);
        if (error)
            throw error;
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/v1/professionals/:id - Perfil detallado con horario
router.get('/:id', async (req, res, next) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('professionals')
            .select(`
        *,
        schedules:professional_schedules (*),
        services:professional_services (service:services(*))
      `)
            .eq('id', req.params.id)
            .single();
        if (error)
            throw error;
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
});
export const professionalsRouter = router;
