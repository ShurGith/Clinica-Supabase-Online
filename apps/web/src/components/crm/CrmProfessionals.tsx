import React, { useEffect, useState } from 'react';
import { Users, Plus, Save, Trash2, Palmtree, UserCheck, UserX } from 'lucide-react';
import { DAY_NAMES_ES } from '@clinica-eugenia/shared';
import { api } from '../../api.js';
import { useNoticeModal } from '../ui/NoticeModal.js';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const t5 = (t?: string | null) => (t ? t.slice(0, 5) : '');

type DayRow = { day_of_week: number; is_working: boolean; start_time: string; end_time: string; break_start: string; break_end: string };

const buildWeek = (schedules: any[]): DayRow[] =>
  [0, 1, 2, 3, 4, 5, 6].map(d => {
    const s = (schedules || []).find((x: any) => x.day_of_week === d);
    return {
      day_of_week: d,
      is_working: s ? s.is_working : false,
      start_time: t5(s?.start_time) || '09:00',
      end_time: t5(s?.end_time) || '18:00',
      break_start: t5(s?.break_start),
      break_end: t5(s?.break_end),
    };
  });

const inputCls = 'p-1.5 rounded-lg border border-slate-200 text-xs bg-white disabled:bg-slate-50 disabled:text-slate-300';

// Selector de hora nativo en tramos de 30 min; no se puede teclear ni pegar: solo elegir en el selector
const fmtDateEs = (iso: string) => {
  const t = new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function TimeSelect({ value, onChange, disabled, min, max }: { value: string; onChange: (v: string) => void; disabled?: boolean; min?: string; max?: string }) {
  const snap = (v: string) => {
    if (!v) return v;
    const [h, m] = v.split(':');
    const out = `${h}:${Number(m) < 30 ? '00' : '30'}`;
    return min && out < min ? min : max && out > max ? max : out;
  };
  return (
    <input
      type="time"
      step={1800}
      min={min}
      max={max}
      disabled={disabled}
      value={value}
      required
      onChange={e => onChange(snap(e.target.value))}
      onKeyDown={e => { if (!['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault(); }}
      onPaste={e => e.preventDefault()}
      onDrop={e => e.preventDefault()}
      onClick={e => { try { e.currentTarget.showPicker(); } catch { /* sin soporte */ } }}
      className={`${inputCls} cursor-pointer`}
    />
  );
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${m % 60 ? '30' : '00'}`;

// Parte la jornada en mañana y tarde: hueco de 14:00 a 15:00 si cabe, o 30 min en mitad de la jornada
const defaultSplit = (r: DayRow) => {
  const s = toMin(r.start_time), e = toMin(r.end_time);
  if (s < 14 * 60 && e > 15 * 60) return { break_start: '14:00', break_end: '15:00' };
  const bs = s + Math.floor((e - s - 30) / 2 / 30) * 30;
  return e - s >= 90 ? { break_start: fromMin(bs), break_end: fromMin(bs + 30) } : { break_start: '', break_end: '' };
};

function ProfessionalCard({ prof, clinicWeek, onChanged }: { prof: any; clinicWeek: any[]; onChanged: () => void }) {
  const notice = useNoticeModal();
  const [open, setOpen] = useState(false);
  const [week, setWeek] = useState<DayRow[]>(() => buildWeek(prof.schedules));
  const [saving, setSaving] = useState(false);
  const [off, setOff] = useState({ start_date: '', end_date: '', reason: 'Vacaciones' });

  useEffect(() => { setWeek(buildWeek(prof.schedules)); }, [prof.schedules]);

  const clinicDay = (d: number) => clinicWeek.find((c: any) => c.day_of_week === d);
  const isClosed = (d: number) => Boolean(clinicDay(d)?.is_closed);
  const openAt = (d: number) => clinicDay(d)?.open_time?.slice(0, 5);
  const closeAt = (d: number) => clinicDay(d)?.close_time?.slice(0, 5);
  const patchDay = (day: number, patch: Partial<DayRow>) =>
    setWeek(w => w.map(r => (r.day_of_week === day ? { ...r, ...patch } : r)));

  const saveSchedule = async () => {
    setSaving(true);
    try {
      await api.updateProfessionalSchedule(prof.id, week.map(r => (isClosed(r.day_of_week) ? { ...r, is_working: false } : r)));
      notice.notify('Horario guardado. Ya se aplica a las nuevas citas y a los cambios de hora.', 'success', 'Horario actualizado');
      onChanged();
    } catch (err: any) {
      notice.notify(err.message || 'No se pudo guardar el horario.');
    } finally {
      setSaving(false);
    }
  };

  const [color, setColor] = useState<string>(prof.color);
  useEffect(() => { setColor(prof.color); }, [prof.color]);

  const saveColor = async () => {
    if (color === prof.color) return;
    try {
      await api.updateProfessional(prof.id, { color });
      onChanged();
    } catch (err: any) {
      notice.notify(err.message || 'No se pudo cambiar el color.');
    }
  };

  const toggleActive = async () => {
    try {
      await api.updateProfessional(prof.id, { is_active: !prof.is_active });
      onChanged();
    } catch (err: any) {
      notice.notify(err.message || 'No se pudo cambiar el estado.');
    }
  };

  const addTimeOff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createProfessionalTimeOff(prof.id, off);
      setOff({ start_date: '', end_date: '', reason: 'Vacaciones' });
      onChanged();
    } catch (err: any) {
      notice.notify(err.message || 'No se pudo registrar la ausencia.');
    }
  };

  const removeTimeOff = async (id: string) => {
    if (!await notice.confirm('¿Eliminar esta ausencia?', 'Eliminar ausencia')) return;
    try {
      await api.deleteProfessionalTimeOff(prof.id, id);
      onChanged();
    } catch (err: any) {
      notice.notify(err.message || 'No se pudo eliminar la ausencia.');
    }
  };

  const timeOff = [...(prof.time_off || [])].sort((a: any, b: any) => b.start_date.localeCompare(a.start_date));

  return (
    <div className={`rounded-2xl border ${prof.is_active ? 'border-slate-200' : 'border-slate-200 opacity-60'} bg-white`}>
      {notice.modal}
      <div className="flex items-center gap-3 p-4">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: prof.color }} />
        <button onClick={() => setOpen(o => !o)} className="flex-1 min-w-0 text-left">
          <strong className="block text-sm text-slate-900 truncate">{prof.first_name} {prof.last_name}</strong>
          <span className="text-[11px] text-slate-500">
            {prof.specialty}{prof.collegiated_number ? ` · Col. ${prof.collegiated_number}` : ''}{prof.is_active ? '' : ' · Inactivo'}
          </span>
          <span className="mt-2 flex flex-wrap gap-1">
            {DAY_ORDER.map(d => {
              const r = week.find(x => x.day_of_week === d)!;
              return r.is_working && !isClosed(d) ? (
                <span key={d} className="text-[10px] font-semibold rounded-md bg-slate-100 text-slate-700 px-1.5 py-0.5">
                  {DAY_NAMES_ES[d].slice(0, 3)} {r.break_start ? `${r.start_time}–${r.break_start} · ${r.break_end}–${r.end_time}` : `${r.start_time}–${r.end_time}`}
                </span>
              ) : (
                <span key={d} className="text-[10px] rounded-md bg-slate-50 text-slate-300 px-1.5 py-0.5 line-through">{DAY_NAMES_ES[d].slice(0, 3)}</span>
              );
            })}
          </span>
          {(prof.time_off || []).length > 0 && (
            <span className="mt-1 block text-[10px] text-amber-700">
              Ausencias: {(prof.time_off as any[]).length} registrada(s)
            </span>
          )}
        </button>
        <button
          onClick={toggleActive}
          className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
        >
          {prof.is_active ? <><UserX className="w-3.5 h-3.5" /> Desactivar</> : <><UserCheck className="w-3.5 h-3.5" /> Activar</>}
        </button>
        <button
          onClick={() => setOpen(o => !o)}
          className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-700"
        >
          {open ? 'Cerrar' : 'Editar'}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-100 p-4 space-y-5">
          <label className="flex items-center gap-3 text-xs font-bold text-slate-700">
            Color en la agenda
            <input type="color" value={color} onChange={e => setColor(e.target.value)} onBlur={saveColor} className="h-8 w-12 cursor-pointer rounded border border-slate-200" />
            <span className="font-normal text-slate-400">{color}</span>
          </label>
          <div className="space-y-1.5">
            {DAY_ORDER.map(d => {
              const r = week.find(x => x.day_of_week === d)!;
              const closed = isClosed(d);
              const split = r.is_working && !closed && Boolean(r.break_start);
              const lo = openAt(d), hi = closeAt(d);
              return (
                <div key={d} className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="flex items-center gap-2 w-28 font-bold text-slate-800">
                    <input type="checkbox" disabled={closed} checked={r.is_working && !closed} onChange={e => patchDay(d, { is_working: e.target.checked })} />
                    {DAY_NAMES_ES[d]}
                  </label>
                  {closed ? <span className="text-slate-400 italic">Centro cerrado</span> : (<>
                  <TimeSelect min={lo} max={hi} disabled={!r.is_working} value={r.start_time} onChange={v => patchDay(d, { start_time: v })} />
                  <span className="text-slate-400">–</span>
                  {split ? (
                    <TimeSelect min={lo} max={hi} value={r.break_start} onChange={v => patchDay(d, { break_start: v })} />
                  ) : (
                    <TimeSelect min={lo} max={hi} disabled={!r.is_working} value={r.end_time} onChange={v => patchDay(d, { end_time: v })} />
                  )}
                  <label className="flex items-center gap-1.5 ml-2 text-slate-600 font-semibold">
                    <input
                      type="checkbox"
                      disabled={!r.is_working}
                      checked={split}
                      onChange={e => patchDay(d, e.target.checked ? defaultSplit(r) : { break_start: '', break_end: '' })}
                    />
                    Partida
                  </label>
                  {split && (
                    <>
                      <TimeSelect min={lo} max={hi} value={r.break_end} onChange={v => patchDay(d, { break_end: v })} />
                      <span className="text-slate-400">–</span>
                      <TimeSelect min={lo} max={hi} value={r.end_time} onChange={v => patchDay(d, { end_time: v })} />
                    </>
                  )}
                  </>)}
                </div>
              );
            })}
          </div>
          <button
            onClick={saveSchedule}
            disabled={saving}
            className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs px-4 py-2 rounded-xl"
          >
            <Save className="w-4 h-4" /> {saving ? 'Guardando...' : 'Guardar horario'}
          </button>

          <div className="pt-4 border-t border-slate-100 space-y-3">
            <h4 className="font-extrabold text-slate-900 text-xs flex items-center gap-1.5">
              <Palmtree className="w-4 h-4 text-amber-500" /> Vacaciones y ausencias
            </h4>
            {timeOff.length === 0 ? (
              <p className="text-xs text-slate-400">Sin ausencias registradas.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {timeOff.map((t: any) => (
                  <li key={t.id} className="py-2 flex items-center justify-between text-xs">
                    <span><strong className="text-slate-800">{t.reason}</strong> · {fmtDateEs(t.start_date)} → {fmtDateEs(t.end_date)}</span>
                    <button onClick={() => removeTimeOff(t.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50" title="Eliminar ausencia">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addTimeOff} className="flex flex-wrap items-end gap-2 text-xs">
              <label className="space-y-1"><span className="block font-bold text-slate-600">Desde</span>
                <input required type="date" value={off.start_date} onChange={e => setOff({ ...off, start_date: e.target.value })} className={inputCls} /></label>
              <label className="space-y-1"><span className="block font-bold text-slate-600">Hasta</span>
                <input required type="date" value={off.end_date} onChange={e => setOff({ ...off, end_date: e.target.value })} className={inputCls} /></label>
              <label className="space-y-1"><span className="block font-bold text-slate-600">Motivo</span>
                <input required value={off.reason} onChange={e => setOff({ ...off, reason: e.target.value })} className={inputCls} /></label>
              <button type="submit" className="inline-flex items-center gap-1 bg-slate-900 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-slate-700">
                <Plus className="w-3.5 h-3.5" /> Añadir
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export const CrmProfessionals: React.FC = () => {
  const notice = useNoticeModal();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [clinicWeek, setClinicWeek] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', specialty: '', collegiated_number: '', color: '#4f7f8c' });

  const load = () =>
    api.getManagedProfessionals()
      .then(setList)
      .catch(err => notice.notify(err.message || 'No se pudieron cargar los profesionales.'))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    api.getAllSchedules().then((d: any) => setClinicWeek(d?.clinic_schedules || [])).catch(() => undefined);
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createProfessional(form);
      setForm({ first_name: '', last_name: '', specialty: '', collegiated_number: '', color: '#4f7f8c' });
      setAdding(false);
      load();
    } catch (err: any) {
      notice.notify(err.message || 'No se pudo crear el profesional.');
    }
  };

  return (
    <div className="space-y-6">
      {notice.modal}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-brand-600" /> Profesionales y horarios
          </h2>
        </div>
        <button
          onClick={() => setAdding(a => !a)}
          className="bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs px-3 py-2 rounded-xl flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Nuevo profesional
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Las citas solo se pueden dar y mover dentro de la jornada del profesional y fuera de sus ausencias.
        Cada hora admite tantas citas como profesionales activos.
      </p>

      {adding && (
        <form onSubmit={create} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs p-4 rounded-2xl bg-slate-50 border border-slate-100">
          <input required placeholder="Nombre" value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} className={inputCls} />
          <input required placeholder="Apellidos" value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} className={inputCls} />
          <input required placeholder="Especialidad" value={form.specialty} onChange={e => setForm({ ...form, specialty: e.target.value })} className={inputCls} />
          <input placeholder="Nº de colegiado (opcional)" value={form.collegiated_number} onChange={e => setForm({ ...form, collegiated_number: e.target.value })} className={inputCls} />
          <label className="flex items-center gap-2 font-bold text-slate-600">Color
            <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="px-3 py-1.5 rounded-lg font-bold text-slate-600 hover:bg-slate-100">Cancelar</button>
            <button type="submit" className="px-4 py-1.5 rounded-lg font-bold bg-slate-900 text-white hover:bg-slate-700">Crear</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="py-8 text-center text-xs text-slate-400">Cargando profesionales...</div>
      ) : list.length === 0 ? (
        <div className="p-6 rounded-2xl bg-slate-50 text-center text-xs text-slate-400">No hay profesionales.</div>
      ) : (
        <div className="space-y-3">
          {list.map(p => <ProfessionalCard key={p.id} prof={p} clinicWeek={clinicWeek} onChanged={load} />)}
        </div>
      )}
    </div>
  );
};
