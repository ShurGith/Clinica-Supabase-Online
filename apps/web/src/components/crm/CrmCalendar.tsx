import React, { useState, useEffect, useRef, useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { api } from '../../api.js';
import {
  ChevronLeft, ChevronRight, Plus, RefreshCw, CheckCircle2, AlertCircle,
  X, Phone, User, Calendar, Clock, MessageSquare, Trash2, Hourglass, CheckCheck, Ban
} from 'lucide-react';
import { APPOINTMENT_STATUS_COLORS, APPOINTMENT_STATUS_LABELS } from '@clinica-eugenia/shared';
import { useNoticeModal } from '../ui/NoticeModal.js';
import { DayResourceView } from './DayResourceView';

const readableAppointmentError = (message: string | undefined, fallback: string, professionalName?: string) =>
  message?.includes('CONFLICT_BLOCKED_SLOT')
    ? 'Ese horario está bloqueado o corresponde a un festivo. Elige otra fecha u hora.'
    : message?.includes('CONFLICT_SCHEDULE')
      ? 'Ese horario queda fuera de la jornada del profesional o coincide con una ausencia suya. Revisa sus horarios y ausencias en Horarios → Profesionales.'
      : message?.includes('CONFLICT_PROFESSIONAL')
        ? `${professionalName || 'El profesional'} ya tiene ocupada esta hora.`
        : message?.includes('CONFLICT_OPERATORY')
          ? 'El gabinete ya está ocupado en ese horario.'
          : message || fallback;

// Paleta de tonos pastel elegantes para las tarjetas de cita por odontólogo
const PROF_PALETTES = [
  { dot: '#b4694f', bg: '#f6e6df', border: '#e5c3b6', text: '#7a3f2b', shift: 'Todo el día' },
  { dot: '#4f7f8c', bg: '#e3edef', border: '#bfd3d8', text: '#2f5560', shift: 'Mañanas' },
  { dot: '#7a5f86', bg: '#ece5ef', border: '#d3c6d9', text: '#553f61', shift: 'Tardes' },
  { dot: '#7d7a3f', bg: '#eeeedd', border: '#d6d5b1', text: '#55532a', shift: 'Tardes' },
  { dot: '#a3793a', bg: '#f3ead9', border: '#e0cfa9', text: '#6b4d1f', shift: 'Mañanas' },
];

const mixHex = (hex: string, withHex: string, t: number) => {
  const a = hex.slice(1).match(/../g)!.map(h => parseInt(h, 16));
  const b = withHex.slice(1).match(/../g)!.map(h => parseInt(h, 16));
  return '#' + a.map((v, i) => Math.round(v * (1 - t) + b[i] * t).toString(16).padStart(2, '0')).join('');
};

// Paleta de la tarjeta a partir del color elegido para el profesional (Profesionales); si no hay, la de respaldo
const paletteFor = (prof: any, idx: number) => {
  const fallback = PROF_PALETTES[Math.max(idx, 0) % PROF_PALETTES.length];
  const c = prof?.color;
  if (!/^#[0-9a-fA-F]{6}$/.test(c || '')) return fallback;
  return { dot: c, bg: mixHex(c, '#ffffff', 0.86), border: mixHex(c, '#ffffff', 0.62), text: mixHex(c, '#000000', 0.5), shift: fallback.shift };
};

// Fuera del componente: un objeto nuevo en cada render haría que FullCalendar recalcule la vista al abrir/cerrar el modal
const CALENDAR_PLUGINS = [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin];
const CALENDAR_VIEWS = { timeGridWeek: { type: 'timeGrid', duration: { days: 7 } } };

export const CrmCalendar: React.FC = () => {
  const notice = useNoticeModal();
  const calendarRef = useRef<FullCalendar>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dayDate, setDayDate] = useState<Date>(() => new Date());
  const [createProfId, setCreateProfId] = useState<string | null>(null);
  const [professionals, setProfessionals] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [clinicWeek, setClinicWeek] = useState<any[] | null>(null);
  const [profSchedules, setProfSchedules] = useState<any[]>([]);
  const professionalNameFor = (professionalId?: string) => {
    const professional = professionals.find((item: any) => item.id === professionalId);
    return professional ? `${professional.first_name} ${professional.last_name}`.trim() : undefined;
  };

  // Filtros
  const [filterProf, setFilterProf] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);

  // Navegación y vista actual
  const [currentTitle, setCurrentTitle] = useState('Noviembre de 2026');
  const [currentView, setCurrentView] = useState<'timeGridWeek' | 'timeGridDay' | string>('timeGridWeek');

  // Modales y Drawer
  const [selectedAppointment, setSelectedAppointment] = useState<any | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createSlotDate, setCreateSlotDate] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'ok' | 'err' } | null>(null);
  const showToast = (message: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = async () => {
    try {
      const [apptsData, profsData, srvsData, patientsData, schedulesData, managedData] = await Promise.all([
        api.getAppointments(),
        api.getProfessionals(),
        api.getServices(),
        api.getPatients(),
        api.getAllSchedules(),
        api.getManagedProfessionals().catch(() => []),
      ]);
      setProfSchedules(managedData);

      setClinicWeek(schedulesData?.clinic_schedules || []);
      setAppointments(apptsData);
      setProfessionals(profsData);
      setServices(srvsData);
      setPatients(patientsData);
      setLoaded(true);
    } catch (err: any) {
      console.error(err);
      showToast('Error cargando datos del calendario', 'err');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Mantener al día la ficha abierta cuando cambian los datos de la cita (mover, redimensionar, estado)
  useEffect(() => {
    setSelectedAppointment((prev: any) => {
      if (!prev) return prev;
      const fresh = appointments.find(a => a.id === prev.id);
      return fresh && fresh !== prev ? fresh : prev;
    });
  }, [appointments]);

  // Mapear eventos a FullCalendar con los filtros activos
  useEffect(() => {
    const fcEvents = appointments
      .filter(a => {
        if (filterProf.length && !filterProf.includes(a.professional_id)) return false;
        if (filterStatus && a.status !== filterStatus) return false;
        const isCancelled = a.status === 'cancelled_by_patient' || a.status === 'cancelled_by_clinic' || a.status === 'no_show';
        if (!showCancelled && isCancelled) return false;
        return true;
      })
      .map(a => {
        const profName = a.professional ? `${a.professional.first_name} ${a.professional.last_name}` : '';
        const patName = a.patient ? `${a.patient.first_name} ${a.patient.last_name}` : 'Paciente';
        const srvName = a.service?.name || 'Tratamiento';
        const color = APPOINTMENT_STATUS_COLORS[a.status] || a.professional?.color || '#0d9488';

        return {
          id: a.id,
          title: `${patName} · ${srvName}`,
          start: a.start_time,
          end: a.end_time,
          backgroundColor: color,
          borderColor: color,
          textColor: '#ffffff',
          extendedProps: {
            ...a,
            patientName: patName,
            professionalName: profName,
            serviceName: srvName,
          },
        };
      });

    setEvents(fcEvents);
  }, [appointments, filterProf, filterStatus, showCancelled]);

  // Valida al soltar (antes de cualquier confirmación) si la cita cabe en el nuevo hueco; devuelve el motivo de rechazo
  const validateDrop = (appt: any, start: Date, end: Date): string | null => {
    const tz = 'Europe/Madrid';
    const part = (d: Date) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
      }).formatToParts(d).map(x => [x.type, x.value]));
      return {
        ymd: `${p.year}-${p.month}-${p.day}`,
        dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
        min: Number(p.hour) * 60 + Number(p.minute),
      };
    };
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const a = part(start), b = part(end);
    const endMin = b.ymd === a.ymd ? b.min : 24 * 60;
    const fits = (ranges: [number, number][]) => ranges.some(([f, t]) => a.min >= f && endMin <= t);
    const rangesOf = (open: string, close: string, bs?: string | null, be?: string | null): [number, number][] => {
      const o = toMin(open), c = toMin(close);
      if (bs && be && o < toMin(bs) && toMin(bs) < toMin(be) && toMin(be) < c) return [[o, toMin(bs)], [toMin(be), c]];
      return [[o, c]];
    };

    const DAYS = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
    const hm = (t: string) => t.slice(0, 5);
    const who = appt.professional ? `${appt.professional.first_name} ${appt.professional.last_name}` : 'El profesional';
    // Motivo concreto por el que un tramo no cabe en una jornada (con pausa opcional)
    const whyNot = (open: string, close: string, bs?: string | null, be?: string | null) => {
      const ranges = rangesOf(open, close, bs, be);
      if (fits(ranges)) return null;
      if (ranges.length === 2 && a.min < ranges[1][0] && endMin > ranges[0][1]) {
        return `en la pausa (${hm(bs!)}–${hm(be!)})`;
      }
      return `fuera de su horario (${ranges.map(([f, t]) => `${String(Math.floor(f / 60)).padStart(2, '0')}:${String(f % 60).padStart(2, '0')}–${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`).join(' y ')})`;
    };

    const clash = appointments.find(o =>
      o.id !== appt.id && o.professional_id === appt.professional_id &&
      !['cancelled_by_patient', 'cancelled_by_clinic'].includes(o.status) &&
      new Date(o.start_time) < end && new Date(o.end_time) > start);
    if (clash) return `${who} ya tiene ocupada esa hora.`;

    const prof = profSchedules.find((p: any) => p.id === appt.professional_id);
    if (prof) {
      const day = (prof.schedules || []).find((d: any) => d.day_of_week === a.dow);
      if (!day || !day.is_working) return `${who} no atiende los ${DAYS[a.dow]}.`;
      const off = (prof.time_off || []).find((t: any) => a.ymd >= t.start_date && a.ymd <= t.end_date);
      if (off) return `${who} tiene una ausencia (${off.reason || 'ausencia'}) ese día.`;
      const why = whyNot(day.start_time, day.end_time, day.break_start, day.break_end);
      if (why) return `${who} no atiende a esa hora: queda ${why}.`;
    }

    const clinic = (clinicWeek || []).find((d: any) => d.day_of_week === a.dow);
    if (clinic) {
      if (clinic.is_closed) return `La clínica está cerrada los ${DAYS[a.dow]}.`;
      const why = whyNot(clinic.open_time, clinic.close_time, clinic.lunch_start, clinic.lunch_end);
      if (why) return `La clínica no atiende a esa hora: queda ${why.replace('su horario', 'el horario de la clínica')}.`;
    }
    return null;
  };

  // Mueve una cita (arrastre en la semana o en la vista de día por profesional): valida, confirma y guarda
  const processMove = async (
    appt: any, start: Date, end: Date, oldStart: Date, newProf: any | null, revert: () => void,
  ) => {
    const newStart = start.toISOString();
    const newEnd = end.toISOString();
    if (new Date(newStart).getTime() < Date.now() - 3 * 60 * 60 * 1000) {
      revert();
      notice.notify('No se pueden programar citas anteriores a hace tres horas.');
      return;
    }
    const changesProf = Boolean(newProf && newProf.id !== appt.professional_id);
    const target = changesProf ? { ...appt, professional_id: newProf.id, professional: newProf } : appt;
    const rejection = validateDrop(target, start, end);
    if (rejection) {
      revert();
      notice.notify(`${rejection}\nLa cita se ha dejado donde estaba.`, 'error', 'Cita rechazada');
      return;
    }
    const patientName = appt.patientName || (appt.patient ? `${appt.patient.first_name} ${appt.patient.last_name}` : 'el paciente');
    const fmt = (d: Date) => d.toLocaleString('es-ES', {
      timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });
    const when = fmt(new Date(newStart));
    const profLine = changesProf ? `\nProfesional: ${newProf.first_name} ${newProf.last_name}` : '';
    const moveConfirmed = await notice.confirm(
      `Cita de ${patientName}\nDe: ${fmt(oldStart)}\nA: ${when}${profLine}`,
      'Reprogramar cita',
      'Mover cita',
      { cancelLabel: 'Dejar como estaba' },
    );
    if (!moveConfirmed) {
      revert();
      return;
    }
    const hasPhone = Boolean(appt.patient?.phone);
    const notifyWhatsApp = hasPhone && await notice.confirm(
      `¿Quieres avisar a ${patientName} por WhatsApp de que su cita pasa al ${when}?`,
      'Avisar al paciente',
      'Enviar WhatsApp',
      { cancelLabel: 'No enviar', tone: 'whatsapp' },
    );

    try {
      const moved = await api.moveAppointment({
        appointment_id: appt.id,
        start_time: newStart,
        end_time: newEnd,
        ...(changesProf ? { professional_id: newProf.id, operatory_id: newProf.default_operatory_id || undefined } : {}),
        reason: 'Reprogramación arrastrando en calendario visual',
        notify_whatsapp: notifyWhatsApp,
      });
      const wa = moved?.whatsapp;
      if (wa?.requested && !wa.sent) {
        showToast(`Cita de ${patientName} movida al ${when}, pero no se pudo enviar el WhatsApp.`, 'err');
      } else {
        showToast(wa?.sent
          ? `Cita de ${patientName} movida al ${when}. Aviso por WhatsApp enviado.`
          : `Cita de ${patientName} movida al ${when}. Sin aviso al paciente.`);
      }
      await loadData();
    } catch (err: any) {
      revert();
      const professionalName = newProf
        ? `${newProf.first_name} ${newProf.last_name}`.trim()
        : appt.professionalName || professionalNameFor(appt.professional_id);
      notice.notify(readableAppointmentError(err.message, 'No se puede mover la cita: hueco ocupado o fuera de horario.', professionalName) + '\nLa cita se ha dejado donde estaba.', 'error', 'Cita rechazada');
    }
  };

  const handleEventDrop = (info: any) =>
    processMove(info.event.extendedProps, info.event.start, info.event.end, info.oldEvent.start, null, info.revert);

  // Vista de día por profesional
  const handleResourceResize = async (appt: any, end: Date) => {
    const start = new Date(appt.start_time);
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
    try {
      await api.resizeAppointment({
        appointment_id: appt.id,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        duration_minutes: durationMinutes,
      });
      showToast(`Duración actualizada a ${durationMinutes} minutos`);
      loadData();
    } catch (err: any) {
      notice.notify(readableAppointmentError(
        err.message,
        'No se puede cambiar la duración: entra en conflicto con otra cita.',
        appt.professionalName || professionalNameFor(appt.professional_id),
      ), 'error', 'Cambio rechazado');
    }
  };

  // Redimensionar duración de cita
  const handleEventResize = async (info: any) => {
    const apptId = info.event.id;
    const newStart = info.event.start.toISOString();
    const newEnd = info.event.end.toISOString();
    const durationMinutes = Math.round((info.event.end.getTime() - info.event.start.getTime()) / 60000);

    try {
      await api.resizeAppointment({
        appointment_id: apptId,
        start_time: newStart,
        end_time: newEnd,
        duration_minutes: durationMinutes,
      });
      showToast(`Duración actualizada a ${durationMinutes} minutos`);
      loadData();
    } catch (err: any) {
      info.revert();
      const appt = info.event.extendedProps;
      showToast(readableAppointmentError(
        err.message,
        'No se puede cambiar la duración: entra en conflicto con otra cita.',
        appt.professionalName || professionalNameFor(appt.professional_id),
      ), 'err');
    }
  };

  // Click en cita: abrir panel lateral
  const handleEventClick = (info: any) => {
    const appt = appointments.find(a => a.id === info.event.id);
    if (appt) {
      setSelectedAppointment(appt);
      setIsDetailOpen(true);
    }
  };

  // Tramos de trabajo por día
  const businessHours = useMemo(() => (clinicWeek || []).flatMap((d: any) => {
    if (d.is_closed) return [];
    const open = d.open_time.slice(0, 5), close = d.close_time.slice(0, 5);
    const ls = d.lunch_start?.slice(0, 5), le = d.lunch_end?.slice(0, 5);
    if (ls && le && open < ls && ls < le && le < close) {
      return [
        { daysOfWeek: [d.day_of_week], startTime: open, endTime: ls },
        { daysOfWeek: [d.day_of_week], startTime: le, endTime: close },
      ];
    }
    return [{ daysOfWeek: [d.day_of_week], startTime: open, endTime: close }];
  }), [clinicWeek]);

  const hiddenDays = useMemo(() => {
    if (!clinicWeek?.length) return [];
    const closed = clinicWeek.filter((d: any) => d.is_closed).map((d: any) => d.day_of_week);
    return closed.length < 7 ? closed : [];
  }, [clinicWeek]);

  // Primer día desde hoy con citas (en día abierto); si no hay ninguna, hoy o el próximo día laborable
  const startDate = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isOpen = (d: Date) => {
      const row = clinicWeek?.find((w: any) => w.day_of_week === d.getDay());
      return !clinicWeek?.length || (row && !row.is_closed);
    };
    let first: Date | null = null;
    for (const a of appointments) {
      if (!a.start_time || ['cancelled_by_patient', 'cancelled_by_clinic', 'no_show'].includes(a.status)) continue;
      const d = new Date(a.start_time);
      d.setHours(0, 0, 0, 0);
      if (d >= today && isOpen(d) && (!first || d < first)) first = d;
    }
    if (first) return first;
    const d = new Date(today);
    for (let i = 0; i < 7 && !isOpen(d); i++) d.setDate(d.getDate() + 1);
    return d;
  }, [clinicWeek, appointments]);

  const positionedRef = useRef(false);
  useEffect(() => {
    if (!clinicWeek || !loaded || positionedRef.current) return;
    positionedRef.current = true;
    calendarRef.current?.getApi().gotoDate(startDate);
  }, [clinicWeek, loaded, startDate]);

  // El eje horario cubre la apertura de la clínica y cualquier cita fuera de ese horario
  const { slotMin, slotMax } = useMemo(() => {
    const opens = (clinicWeek || []).filter((d: any) => !d.is_closed).map((d: any) => d.open_time.slice(0, 5));
    const closes = (clinicWeek || []).filter((d: any) => !d.is_closed).map((d: any) => d.close_time.slice(0, 5));
    let minH = opens.length ? Number(opens.sort()[0].slice(0, 2)) : 8;
    let maxH = closes.length ? Math.min(24, Number(closes.sort().slice(-1)[0].slice(0, 2)) + 1) : 21;
    for (const a of appointments) {
      if (!a.start_time || !a.end_time) continue;
      const st = new Date(a.start_time);
      const en = new Date(a.end_time);
      minH = Math.min(minH, st.getHours());
      maxH = Math.max(maxH, Math.min(24, en.getHours() + (en.getMinutes() > 0 ? 1 : 0)));
    }
    return {
      slotMin: `${String(minH).padStart(2, '0')}:00`,
      slotMax: maxH >= 24 ? '24:00:00' : `${String(maxH).padStart(2, '0')}:00`,
    };
  }, [clinicWeek, appointments]);

  const isBookable = (date: Date, allDay: boolean) => {
    const day = date.getDay();
    const ranges = businessHours.filter(b => b.daysOfWeek[0] === day);
    if (!ranges.length) return false;
    if (allDay) return true;
    const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    return ranges.some(r => hm >= r.startTime && hm < r.endTime);
  };

  // Fantasma de "nueva cita" al pasar el ratón por un hueco libre
  // Citas simultáneas permitidas: tantas como profesionales disponibles
  const capacity = Math.max(1, filterProf.length || professionals.length);
  const calWrapRef = useRef<HTMLDivElement>(null);
  // El fantasma se mueve por DOM (sin estado) para no re-renderizar FullCalendar en cada movimiento del ratón
  const ghostRef = useRef<HTMLDivElement>(null);
  const ghostLabelRef = useRef<HTMLSpanElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const setHoverSlot = (slot: { left: number; top: number; width: number; height: number; label: string; mx: number; my: number } | null) => {
    const g = ghostRef.current, b = badgeRef.current;
    if (!g || !b) return;
    if (!slot) { g.style.display = 'none'; b.style.display = 'none'; return; }
    g.style.display = 'flex';
    g.style.left = `${slot.left}px`;
    g.style.top = `${slot.top}px`;
    g.style.width = `${slot.width}px`;
    g.style.height = `${slot.height}px`;
    if (ghostLabelRef.current) ghostLabelRef.current.textContent = slot.label;
    b.style.display = 'flex';
    b.style.left = `${slot.mx + 4}px`;
    b.style.top = `${slot.my + 6}px`;
  };

  const handleCalMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const wrap = calWrapRef.current;
    if (!wrap) return;
    // Con un botón pulsado (arrastrando una cita) no hay fantasma
    if (e.buttons !== 0) { setHoverSlot(null); return; }
    const stack = document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[];
    const col = stack.find(el => el.classList.contains('fc-timegrid-col'));
    const lane = stack.find(el => el.classList.contains('fc-timegrid-slot-lane'));
    if (!col || !lane?.dataset.time || stack.some(el => el.classList.contains('fc-event'))) {
      setHoverSlot(null);
      return;
    }
    const fr = col.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const lr = lane.getBoundingClientRect();
    const hm = lane.dataset.time.slice(0, 5);
    const top = lr.top;
    // Si hay zona rayada (cerrada) en el bloque de 30 min, no es un hueco libre
    const closedAt = (clientY: number) =>
      document.elementsFromPoint(e.clientX, clientY).some(el => el.classList.contains('fc-non-business'));
    const blockBottom = Math.min(top + lr.height * 2, fr.bottom);
    if (closedAt(top + 2) || closedAt(blockBottom - 2)) { setHoverSlot(null); return; }
    // Citas que ya ocupan ese tramo: el hueco libre empieza a la derecha de la última
    let freeLeft = fr.left;
    let concurrent = 0;
    col.querySelectorAll('.fc-timegrid-event-harness').forEach(h => {
      const r = h.getBoundingClientRect();
      if (r.top < blockBottom - 1 && r.bottom > top + 1) {
        concurrent++;
        freeLeft = Math.max(freeLeft, r.right);
      }
    });
    if (concurrent >= capacity || fr.right - freeLeft < 28) { setHoverSlot(null); return; }
    setHoverSlot({
      left: freeLeft - wr.left + 2,
      top: top - wr.top,
      width: fr.right - freeLeft - 4,
      height: blockBottom - top,
      label: hm,
      mx: e.clientX - wr.left,
      my: e.clientY - wr.top,
    });
  };

  // Crear cita al pulsar un hueco
  const handleDateClick = (info: any) => {
    if (!isBookable(info.date, info.allDay)) {
      notice.notify(
        info.allDay
          ? 'La clínica no abre ese día, así que no se pueden crear citas en él.'
          : 'Esa hora está fuera del horario de apertura de la clínica. Elige un hueco dentro del horario (las zonas rayadas están cerradas).',
        'info',
        'Horario no disponible',
      );
      return;
    }
    setCreateSlotDate(info.dateStr);
    setIsCreateOpen(true);
  };

  // Cambio de estado
  const handleChangeStatus = async (newStatus: string, reason?: string) => {
    if (!selectedAppointment) return;
    try {
      await api.updateAppointmentStatus(selectedAppointment.id, newStatus, reason);
      showToast(`Cita marcada como ${APPOINTMENT_STATUS_LABELS[newStatus] || newStatus}`);
      setSelectedAppointment((prev: any) => prev ? { ...prev, status: newStatus } : null);
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Error al cambiar estado', 'err');
    }
  };

  // Enviar confirmación por WhatsApp
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const [operatories, setOperatories] = useState<any[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    api.getOperatories().then(setOperatories).catch(() => setOperatories([]));
  }, []);

  // Guarda al instante el cambio de un selector; si es de odontólogo, propone su gabinete por defecto
  const handleDetailChange = async (field: 'service_id' | 'professional_id' | 'operatory_id', value: string) => {
    const appt = selectedAppointment;
    if (!appt || !value || savingEdit) return;
    const changes: { service_id?: string; professional_id?: string; operatory_id?: string } = { [field]: value };
    if (field === 'professional_id') {
      const def = professionals.find((p: any) => p.id === value)?.default_operatory_id;
      if (def) changes.operatory_id = def;
    }
    setSavingEdit(true);
    try {
      await api.updateAppointmentDetails(appt.id, changes);
      showToast('Cita actualizada');
      await loadData();
    } catch (err: any) {
      notice.notify(readableAppointmentError(
        err.message,
        'No se pueden aplicar los cambios: conflicto con otra cita.',
        professionalNameFor(changes.professional_id || appt.professional_id),
      ), 'error', 'Cambio rechazado');
    } finally {
      setSavingEdit(false);
    }
  };
  const handleSendAppointmentWhatsApp = async () => {
    const appt = selectedAppointment;
    const phone = appt?.patient?.phone;
    if (!appt || !phone || sendingWhatsApp) return;

    const name = [appt.patient?.first_name, appt.patient?.last_name].filter(Boolean).join(' ') || 'el paciente';
    const start = new Date(appt.start_time);
    const confirmed = await notice.confirm(
      `Se enviará a ${name} la confirmación de su cita por WhatsApp.`,
      'Enviar confirmación',
      'Enviar WhatsApp',
      { cancelLabel: 'Cancelar', tone: 'whatsapp' },
    );
    if (!confirmed) return;

    setSendingWhatsApp(true);
    try {
      await api.sendWhatsAppMessage({
        phone_number: phone,
        content: 'Confirmación de cita',
        template_code: 'cita_confirmada',
        template_variables: {
          nombre: appt.patient.first_name,
          fecha: start.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
          hora: start.toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }),
          profesional: `${appt.professional?.first_name || ''} ${appt.professional?.last_name || ''}`.trim(),
          servicio: appt.service?.name || 'Tratamiento dental',
          enlace_gestion: `${window.location.origin}/reserva/gestion/${appt.id}`,
        },
        appointment_id: appt.id,
      });
      showToast('Confirmación enviada por WhatsApp');
    } catch (err: any) {
      notice.notify(
        err.message || 'No se pudo enviar el WhatsApp con Wawp.',
        'error',
        err.code === 'BLOCKED_BY_DEV_MODE' ? 'Modo de pruebas activo' : undefined,
      );
    } finally {
      setSendingWhatsApp(false);
    }
  };

  // Eliminar cita
  const [deleting, setDeleting] = useState(false);
  const handleDeleteAppointment = async () => {
    const appt = selectedAppointment;
    if (!appt || deleting) return;
    const name = [appt.patient?.first_name, appt.patient?.last_name].filter(Boolean).join(' ') || 'este paciente';
    const start = new Date(appt.start_time);
    const when = `${start.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long' })} a las ${start.toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })}`;

    const confirmed = await notice.confirm(
      `Se eliminará la cita de ${name} del ${when}${appt.service?.name ? ` (${appt.service.name})` : ''}.\n\n` +
      'También se borran sus recordatorios pendientes. Esta acción no se puede deshacer.',
      'Eliminar cita',
      'Eliminar cita',
      { cancelLabel: 'Volver' },
    );
    if (!confirmed) return;

    let notify = false;
    if (appt.patient?.phone) {
      notify = await notice.confirm(
        `¿Quieres enviar a ${name} un WhatsApp informándole de que su cita del ${when} ha sido cancelada?`,
        'Avisar al paciente',
        'Enviar WhatsApp',
        { cancelLabel: 'No enviar', tone: 'whatsapp' },
      );
    }

    setDeleting(true);
    try {
      const result = await api.deleteAppointment(appt.id, notify);
      setIsDetailOpen(false);
      setSelectedAppointment(null);
      loadData();
      if (result.whatsapp.requested && !result.whatsapp.sent) {
        notice.notify(
          `La cita se ha eliminado correctamente, pero el WhatsApp al paciente no se ha enviado.\n\nMotivo: ${result.whatsapp.error || 'error desconocido'}`,
          'info',
          'Cita eliminada · WhatsApp no enviado',
        );
      } else {
        showToast(result.whatsapp.sent ? 'Cita eliminada y paciente avisado por WhatsApp' : 'Cita eliminada');
      }
    } catch (err: any) {
      showToast(err.message || 'No se pudo eliminar la cita', 'err');
    } finally {
      setDeleting(false);
    }
  };

  // Controladores de navegación FullCalendar
  const handlePrev = () => calendarRef.current?.getApi().prev();
  const handleNext = () => calendarRef.current?.getApi().next();
  const handleToday = () => {
    const calendarApi = calendarRef.current?.getApi();
    if (calendarApi) {
      calendarApi.gotoDate(startDate);
      calendarApi.changeView('timeGridDay');
    }
  };
  useEffect(() => {
    if (currentView !== 'timeGridDay') calendarRef.current?.getApi().updateSize();
  }, [currentView]);

  const handleChangeView = (viewName: 'timeGridWeek' | 'timeGridDay') => {
    calendarRef.current?.getApi().changeView(viewName);
  };

  // Actualizar título y vista en fechas
  const handleDatesSet = (arg: any) => {
    setCurrentView(arg.view.type);
    if (arg.view.type === 'timeGridDay') setDayDate(arg.start);
    if (arg.view.type === 'timeGridWeek') {
      const start = arg.start;
      const end = new Date(arg.end.getTime() - 86400000);
      const monthName = start.toLocaleDateString('es-ES', { month: 'long' });
      const year = start.getFullYear();
      setCurrentTitle(`${start.getDate()} – ${end.getDate()} de ${monthName} de ${year}`);
    } else if (arg.view.type === 'timeGridDay') {
      const formatted = arg.start.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      setCurrentTitle(formatted.charAt(0).toUpperCase() + formatted.slice(1));
    } else {
      setCurrentTitle(arg.view.title);
    }
  };

  // Renderizado personalizado de la cabecera de columna (Día + Número + Citas)
  const renderDayHeader = (arg: any) => {
    const date = arg.date;
    const isToday = arg.isToday;
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const dayName = dayNames[date.getDay()];
    const dayNum = date.getDate();

    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const count = appointments.filter(a => {
      if (filterProf.length && !filterProf.includes(a.professional_id)) return false;
      const isCancelled = a.status === 'cancelled_by_patient' || a.status === 'cancelled_by_clinic' || a.status === 'no_show';
      if (!showCancelled && isCancelled) return false;
      return a.start_time?.startsWith(dateStr);
    }).length;

    return (
      <div className="py-2.5 px-1 text-center select-none">
        <div className="text-[10px] font-semibold text-stone-500 tracking-wider uppercase mb-1">
          {dayName}
        </div>
        <button
          type="button"
          title="Ver este día completo"
          onClick={() => {
            const api = calendarRef.current?.getApi();
            api?.gotoDate(date);
            api?.changeView('timeGridDay');
          }}
          className={`block mx-auto my-0.5 cursor-pointer transition ${
            isToday
              ? 'w-9 h-9 rounded-lg bg-stone-900 text-white font-medium text-xl flex items-center justify-center hover:bg-stone-700'
              : 'w-9 h-9 rounded-lg text-xl font-medium text-stone-800 leading-9 hover:bg-stone-200/70'
          }`}
          style={isToday ? undefined : { fontFamily: 'Georgia, serif' }}
        >
          {dayNum}
        </button>
        <div className="text-[10px] text-stone-400 font-medium mt-0.5">
          {count} {count === 1 ? 'cita' : 'citas'}
        </div>
      </div>
    );
  };

  // Renderizado personalizado de la tarjeta de cita (Estilo Tarjeta Pastel Referencia)
  const renderEventContent = (eventInfo: any) => {
    const { event } = eventInfo;
    const appt = event.extendedProps;
    const isSelected = selectedAppointment?.id === event.id;
    const isCancelled = appt.status === 'cancelled_by_patient' || appt.status === 'cancelled_by_clinic' || appt.status === 'no_show';

    const profIndex = professionals.findIndex(p => p.id === appt.professional_id);
    const palette = paletteFor(professionals[profIndex], profIndex);

    const startTime = new Date(appt.start_time).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const endTime = new Date(appt.end_time).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    const patientName = appt.patient ? `${appt.patient.first_name} ${appt.patient.last_name}` : 'Paciente';
    const profName = appt.professional ? `${appt.professional.first_name}` : 'Odontólogo';
    const srvName = appt.service?.name || 'Tratamiento';

    return (
      <div
        className={`h-full w-full rounded-md px-2 py-1 overflow-hidden text-left border ${
          isSelected ? 'border-2 border-stone-900 shadow-md' : ''
        }`}
        style={{
          backgroundColor: isCancelled ? '#f1efea' : palette.bg,
          borderColor: isSelected ? '#1c1917' : (isCancelled ? '#e0ddd5' : palette.border),
          borderLeftWidth: isSelected ? 2 : 3,
          borderLeftColor: isSelected ? '#1c1917' : (isCancelled ? '#cfcbc0' : palette.dot),
          color: palette.text,
        }}
      >
        <div className="text-[10px] leading-tight opacity-70 whitespace-nowrap">
          {startTime}–{endTime}
        </div>
        <div className={`text-[11px] font-medium truncate leading-tight ${isCancelled ? 'line-through opacity-60' : ''}`}>
          {patientName} · {srvName}
        </div>
      </div>
    );
  };

  // Conteo total de citas en vista para el subtítulo
  const totalCitasCount = useMemo(() => {
    return appointments.filter(a => {
      if (filterProf.length && !filterProf.includes(a.professional_id)) return false;
      const isCancelled = a.status === 'cancelled_by_patient' || a.status === 'cancelled_by_clinic' || a.status === 'no_show';
      if (!showCancelled && isCancelled) return false;
      return true;
    }).length;
  }, [appointments, filterProf, showCancelled]);

  return (
    <div className="space-y-4">
      {notice.modal}

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 p-4 rounded-2xl shadow-xl flex items-center gap-3 text-xs font-bold transition animate-in fade-in ${
            toast.type === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {toast.type === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* 1. CABECERA PRINCIPAL: Título "Agenda" + Subtítulo de citas + Botón "Nueva cita" */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div>
          <h1 className="text-3xl sm:text-4xl font-medium text-stone-900 tracking-tight" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
            Agenda
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            {totalCitasCount} citas · Pulsa un hueco para agendar o arrastra una cita para moverla.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <button
            onClick={loadData}
            className="p-3 rounded-lg border border-stone-200 bg-[#fbf9f4] hover:bg-stone-100 text-stone-600 transition"
            title="Recargar agenda"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setCreateSlotDate(new Date().toISOString()); setIsCreateOpen(true); }}
            className="bg-[#1f5c3f] hover:bg-[#184a33] text-white font-semibold text-sm px-5 py-3 rounded-lg transition flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva cita</span>
          </button>
        </div>
      </div>

      {/* 2. SUB-TOOLBAR: Navegación de fechas + Filtros odontólogos + Toggle [Semana | Día] */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Navegación y Rango de Fecha */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={handlePrev}
              className="w-8 h-8 rounded-lg border border-stone-200 bg-[#fbf9f4] hover:bg-stone-100 flex items-center justify-center text-slate-600 transition"
              aria-label="Anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleToday}
              className="h-8 px-3 rounded-lg border border-stone-200 bg-[#fbf9f4] hover:bg-stone-100 text-xs font-bold text-slate-700 transition"
            >
              Hoy
            </button>
            <button
              onClick={handleNext}
              className="w-8 h-8 rounded-lg border border-stone-200 bg-[#fbf9f4] hover:bg-stone-100 flex items-center justify-center text-slate-600 transition"
              aria-label="Siguiente"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <span className="font-extrabold text-slate-900 text-sm sm:text-base ml-2 tracking-tight">
            {currentTitle}
          </span>
        </div>

        {/* Filtros de Odontólogos y Canceladas */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFilterProf([])}
            className={`px-3 py-1 rounded-full text-xs transition ${
              !filterProf.length
                ? 'bg-stone-800 text-white font-semibold'
                : 'bg-[#fbf9f4] border border-stone-200 text-stone-600 hover:bg-stone-100 font-medium'
            }`}
          >
            Todos
          </button>

          {professionals.map((p, idx) => {
            const palette = paletteFor(p, idx);
            const isSelected = filterProf.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => setFilterProf(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs transition ${
                  isSelected
                    ? 'bg-stone-800 text-white font-semibold'
                    : 'bg-[#fbf9f4] border border-stone-200 text-stone-700 hover:bg-stone-100 font-medium'
                }`}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: palette.dot }} />
                <span>{p.first_name} {p.last_name}</span>
                <span className={`text-[10px] ${isSelected ? 'text-slate-300' : 'text-slate-400'}`}>
                  {palette.shift}
                </span>
              </button>
            );
          })}

          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer select-none ml-2">
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={(e) => setShowCancelled(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
            />
            <span>Ver canceladas</span>
          </label>
        </div>

        {/* Segmented Control [ Semana | Día ] */}
        <div className="bg-stone-200/60 p-1 rounded-lg flex items-center shrink-0">
          <button
            onClick={() => handleChangeView('timeGridWeek')}
            className={`px-3 py-1 rounded-lg text-xs transition ${
              currentView === 'timeGridWeek'
                ? 'bg-[#fbf9f4] text-stone-900 font-semibold shadow-xs'
                : 'text-slate-500 hover:text-slate-900 font-semibold'
            }`}
          >
            Semana
          </button>
          <button
            onClick={() => handleChangeView('timeGridDay')}
            className={`px-3 py-1 rounded-lg text-xs transition ${
              currentView === 'timeGridDay'
                ? 'bg-[#fbf9f4] text-stone-900 font-semibold shadow-xs'
                : 'text-slate-500 hover:text-slate-900 font-semibold'
            }`}
          >
            Día
          </button>
        </div>
      </div>

      {/* 3. CALENDARIO + PANEL LATERAL DE DETALLE */}
      <div className="flex items-start gap-4 min-w-0">
        {/* Contenedor Interactivo FullCalendar */}
        <div className="flex-1 min-w-0 agenda-cal relative bg-[#fbf9f4] rounded-2xl border border-stone-200 overflow-hidden"
          ref={calWrapRef}
          style={{ '--agenda-cap': capacity } as React.CSSProperties}
          onMouseMove={handleCalMouseMove}
          onMouseLeave={() => setHoverSlot(null)}
        >
          <div
            ref={ghostRef}
            style={{ display: 'none' }}
            className="absolute z-10 pointer-events-none rounded-md border border-dashed border-[#2f6b46] bg-[#e6f0e0] text-[#1f5c3f] text-[11px] font-bold px-2 py-1 items-start gap-1.5"
          >
            <span className="opacity-70 leading-tight">+</span>
            <span ref={ghostLabelRef} className="leading-tight" />
          </div>
          <div
            ref={badgeRef}
            style={{ display: 'none' }}
            className="absolute z-20 pointer-events-none w-5 h-5 rounded-full bg-[#16a34a] text-white ring-2 ring-[#fbf9f4] shadow items-center justify-center"
          >
            <Plus className="w-3 h-3" strokeWidth={3} />
          </div>
          {currentView === 'timeGridDay' && (
            <DayResourceView
              date={dayDate}
              professionals={filterProf.length ? professionals.filter(p => filterProf.includes(p.id)) : professionals}
              appointments={events.map(e => e.extendedProps)}
              profSchedules={profSchedules}
              clinicWeek={clinicWeek || []}
              slotMinHour={parseInt(slotMin, 10)}
              slotMaxHour={parseInt(slotMax, 10)}
              selectedId={isDetailOpen ? selectedAppointment?.id : null}
              paletteFor={(prof, idx) => paletteFor(prof, professionals.findIndex(x => x.id === prof?.id) >= 0 ? professionals.findIndex(x => x.id === prof.id) : idx)}
              renderAppointment={appt => renderEventContent({ event: { id: appt.id, extendedProps: appt } })}
              onSelect={appt => { setSelectedAppointment(appt); setIsDetailOpen(true); }}
              onCreate={(prof, start) => {
                const pad = (n: number) => String(n).padStart(2, '0');
                setCreateProfId(prof.id);
                setCreateSlotDate(`${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:${pad(start.getMinutes())}:00`);
                setIsCreateOpen(true);
              }}
              onBlocked={(prof, reason) => notice.notify(
                `${prof.first_name} ${prof.last_name}: ${reason || 'ese tramo queda fuera de su horario'}. Elige un hueco libre (las zonas rayadas no están disponibles).`,
                'info',
                'Horario no disponible',
              )}
              onMove={(appt, prof, start, end) => processMove(appt, start, end, new Date(appt.start_time), prof, () => {})}
              onResize={handleResourceResize}
            />
          )}
          <div className={currentView === 'timeGridDay' ? 'hidden' : ''}>
          <FullCalendar
            ref={calendarRef}
            plugins={CALENDAR_PLUGINS}
            initialView={window.matchMedia('(max-width: 639px)').matches ? 'timeGridDay' : 'timeGridWeek'}
            headerToolbar={false}
            views={CALENDAR_VIEWS}
            eventOrder={['start', '-duration', 'title', 'id']}
            locale="es"
            firstDay={1}
            slotMinTime={slotMin}
            slotMaxTime={slotMax}
            businessHours={businessHours}
            selectConstraint="businessHours"
            slotDuration="00:15:00"
            slotEventOverlap={false}
            eventMinHeight={22}
            slotLabelInterval="01:00"
            allDaySlot={false}
            nowIndicator={true}
            editable={true}
            selectable={true}
            selectMirror={true}
            dayMaxEvents={true}
            weekends={true}
            hiddenDays={hiddenDays}
            events={events}
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
            eventClick={handleEventClick}
            dateClick={handleDateClick}
            dayHeaderContent={renderDayHeader}
            eventContent={renderEventContent}
            datesSet={handleDatesSet}
            height="auto"
          />
          </div>
        </div>

        {/* PANEL LATERAL DE DETALLE (SLIDE-OVER / DRAWER LATERAL REFERENCIA) */}
        {isDetailOpen && selectedAppointment && (
          <>
            <div
              className="fixed inset-0 z-40 bg-stone-900/40 backdrop-blur-xs"
              onClick={() => setIsDetailOpen(false)}
            />

            <aside
              role="dialog"
              aria-modal="true"
              className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-md max-h-[90vh] bg-white shadow-2xl p-6 rounded-3xl border border-slate-200 overflow-y-auto flex flex-col justify-between"
            >
              <div className="space-y-5">
                {/* Cabecera del Panel: Estado + Cerrar */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/60">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                    {APPOINTMENT_STATUS_LABELS[selectedAppointment.status] || selectedAppointment.status}
                  </span>

                  <button
                    onClick={() => {
                      setIsDetailOpen(false);
                      setSelectedAppointment(null);
                    }}
                    className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 font-bold transition"
                    aria-label="Cerrar detalle"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Paciente: Avatar Iniciales + Nombre + Teléfono */}
                <div className="flex items-center gap-3.5 pt-1">
                  <div className="w-12 h-12 rounded-full bg-slate-800 text-white font-extrabold text-base flex items-center justify-center shrink-0 shadow-sm">
                    {selectedAppointment.patient?.first_name?.charAt(0) || 'P'}
                    {selectedAppointment.patient?.last_name?.charAt(0) || ''}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-black text-slate-900 tracking-tight truncate leading-tight">
                      {selectedAppointment.patient?.first_name} {selectedAppointment.patient?.last_name}
                    </h3>
                    {selectedAppointment.patient?.phone && (
                      <a
                        href={`tel:${selectedAppointment.patient.phone}`}
                        className="inline-flex items-center gap-1 text-xs text-slate-500 font-medium hover:text-brand-700 transition mt-0.5"
                      >
                        <Phone className="w-3 h-3" />
                        <span>{selectedAppointment.patient.phone}</span>
                      </a>
                    )}
                  </div>
                </div>

                {/* Franja de Fecha y Horario */}
                <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100/90 space-y-1">
                  <div className="text-xs font-bold text-slate-900">
                    {new Date(selectedAppointment.start_time).toLocaleDateString('es-ES', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </div>
                  <div className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      {new Date(selectedAppointment.start_time).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                      {' – '}
                      {new Date(selectedAppointment.end_time).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-500">{selectedAppointment.duration_minutes || 30} min</span>
                  </div>
                </div>

                {/* Campos de Detalle */}
                <div className="space-y-3 text-xs">
                  {([
                    ['Tratamiento', 'detail-service', selectedAppointment.service_id || '', 'service_id', services.map((s: any) => ({ id: s.id, label: s.name }))],
                    ['Odontólogo', 'detail-prof', selectedAppointment.professional_id || '', 'professional_id', professionals.map((p: any) => ({ id: p.id, label: `${p.first_name} ${p.last_name}` }))],
                    ['Gabinete', 'detail-operatory', selectedAppointment.operatory_id || selectedAppointment.operatory?.id || '', 'operatory_id', operatories.map((o: any) => ({ id: o.id, label: o.name }))],
                  ] as [string, string, string, 'service_id' | 'professional_id' | 'operatory_id', { id: string; label: string }[]][]).map(([label, id, value, field, options]) => (
                    <div key={id}>
                      <label htmlFor={id} className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">{label}</label>
                      <select
                        id={id}
                        value={value}
                        disabled={savingEdit}
                        onChange={e => handleDetailChange(field, e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
                      >
                        {!options.some(o => o.id === value) && <option value={value}>—</option>}
                        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                    </div>
                  ))}

                  {selectedAppointment.patient_notes && (
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">
                        Motivo / Notas
                      </span>
                      <div className="p-2.5 rounded-xl bg-slate-50 text-slate-700 text-xs border border-slate-100">
                        {selectedAppointment.patient_notes}
                      </div>
                    </div>
                  )}
                </div>

                {/* Acciones de cambio de estado rápido */}
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                    Actualizar estado
                  </span>
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    <button
                      onClick={() => handleChangeStatus('confirmed')}
                      className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold py-2 px-2.5 rounded-xl transition text-[11px] text-center flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Confirmar
                    </button>
                    <button
                      onClick={() => handleChangeStatus('in_waiting_room')}
                      className="bg-sky-50 hover:bg-sky-100 text-sky-800 font-bold py-2 px-2.5 rounded-xl transition text-[11px] text-center flex items-center justify-center gap-1.5"
                    >
                      <Hourglass className="w-3.5 h-3.5" />
                      En espera
                    </button>
                    <button
                      onClick={() => handleChangeStatus('completed')}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-2 px-2.5 rounded-xl transition text-[11px] text-center flex items-center justify-center gap-1.5"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      Completada
                    </button>
                    <button
                      onClick={() => handleChangeStatus('cancelled_by_patient', 'Solicitud del paciente')}
                      className="bg-rose-50 hover:bg-rose-100 text-rose-800 font-bold py-2 px-2.5 rounded-xl transition text-[11px] text-center flex items-center justify-center gap-1.5"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      Cancelar cita
                    </button>
                  </div>
                </div>

                {/* Botón WhatsApp Wawp */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={handleSendAppointmentWhatsApp}
                    disabled={!selectedAppointment.patient?.phone || sendingWhatsApp}
                    className="w-full bg-[#059669] hover:bg-[#047857] disabled:bg-slate-300 text-white font-bold text-xs py-2.5 px-3 rounded-xl transition flex items-center justify-center gap-2 shadow-xs"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span>{sendingWhatsApp ? 'Enviando WhatsApp…' : 'Enviar WhatsApp con Wawp'}</span>
                  </button>
                </div>
              </div>

              {/* Botones inferiores: Eliminar cita */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3 mt-6">
                <button
                  type="button"
                  onClick={handleDeleteAppointment}
                  disabled={deleting}
                  className="w-full bg-red-600 hover:bg-red-700 active:bg-red-800 disabled:opacity-60 text-white font-bold text-xs py-2.5 px-3 rounded-xl shadow-xs hover:shadow-md transition flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{deleting ? 'Eliminando…' : 'Eliminar cita'}</span>
                </button>
              </div>
            </aside>
          </>
        )}
      </div>

      {/* MODAL CREAR NUEVA CITA */}
      {isCreateOpen && (
        <CreateAppointmentModal
          isOpen={isCreateOpen}
          initialDate={createSlotDate}
          initialProfId={createProfId}
          clinicWeek={clinicWeek}
          patients={patients}
          professionals={professionals}
          services={services}
          onClose={() => { setIsCreateOpen(false); setCreateProfId(null); }}
          onSuccess={() => {
            setIsCreateOpen(false);
            setCreateProfId(null);
            showToast('Cita creada con éxito');
            loadData();
          }}
        />
      )}
    </div>
  );
};

// Modal secundario para crear cita
const CreateAppointmentModal: React.FC<any> = ({
  isOpen, initialDate, initialProfId, clinicWeek, patients, professionals, services, onClose, onSuccess
}) => {
  const notice = useNoticeModal();
  const [patientId, setPatientId] = useState(patients[0]?.id || '');
  const [profId, setProfId] = useState(initialProfId || professionals[0]?.id || '');
  const [serviceId, setServiceId] = useState(services[0]?.id || '');
  const [dateStr, setDateStr] = useState(initialDate ? initialDate.split('T')[0] : '');
  const [timeStr, setTimeStr] = useState(initialDate && initialDate.includes('T') ? initialDate.split('T')[1].slice(0, 5) : '10:00');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<any[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const dateOptions = useMemo(() => {
    const cutoff = Date.now() - 3 * 60 * 60 * 1000;
    return Array.from({ length: 90 }, (_, offset) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const row = clinicWeek?.find((day: any) => day.day_of_week === date.getDay());
      const close = row?.close_time?.slice(0, 5);
      const enabled = Boolean(row && !row.is_closed && close && new Date(`${value}T${close}:00`).getTime() > cutoff);
      return {
        value,
        enabled,
        label: date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }),
      };
    });
  }, [clinicWeek]);

  useEffect(() => {
    if (!dateOptions.some(option => option.value === dateStr && option.enabled)) {
      setDateStr(dateOptions.find(option => option.enabled)?.value || '');
    }
  }, [dateOptions, dateStr]);

  useEffect(() => {
    if (!dateStr || !serviceId || !profId) {
      setAvailableSlots([]);
      return;
    }
    let active = true;
    setLoadingSlots(true);
    api.getAvailableSlots({ service_id: serviceId, professional_id: profId, date: dateStr })
      .then(slots => { if (active) setAvailableSlots(slots); })
      .catch(() => { if (active) setAvailableSlots([]); })
      .finally(() => { if (active) setLoadingSlots(false); });
    return () => { active = false; };
  }, [dateStr, serviceId, profId]);

  useEffect(() => {
    if (availableSlots.length && !availableSlots.some(slot => slot.time_label === timeStr)) {
      setTimeStr(availableSlots[0].time_label);
    }
  }, [availableSlots, timeStr]);

  const availableTimes = new Set(availableSlots.map(slot => slot.time_label));
  const selectedHour = timeStr.slice(0, 2);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const startTime = `${dateStr}T${timeStr}:00+01:00`;
      await api.createAppointment({
        patient_id: patientId,
        professional_id: profId,
        service_id: serviceId,
        start_time: startTime,
        patient_notes: notes || undefined,
        status: 'confirmed',
      });
      onSuccess();
    } catch (err: any) {
      const professional = professionals.find((item: any) => item.id === profId);
      const professionalName = professional
        ? `${professional.first_name} ${professional.last_name}`.trim()
        : undefined;
      notice.notify(readableAppointmentError(
        err.message,
        'Error creando la cita. Puede existir solapamiento de horario.',
        professionalName,
      ));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      {notice.modal}
      <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-lg font-extrabold text-slate-900">Nueva Cita en Agenda</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Paciente *</label>
            <select
              value={patientId}
              onChange={e => setPatientId(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200 text-xs bg-white"
              required
            >
              {patients.map((p: any) => (
                <option key={p.id} value={p.id}>{p.first_name} {p.last_name} ({p.phone})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Tratamiento dental *</label>
            <select
              value={serviceId}
              onChange={e => setServiceId(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200 text-xs bg-white"
              required
            >
              {services.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name} ({s.duration_minutes} min)</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Odontólogo *</label>
            <select
              value={profId}
              onChange={e => setProfId(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200 text-xs bg-white"
              required
            >
              {professionals.map((p: any) => (
                <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Fecha *</label>
              <select
                required
                value={dateStr}
                onChange={e => setDateStr(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 text-xs bg-white"
              >
                {dateOptions.map(option => <option key={option.value} value={option.value} disabled={!option.enabled}>{option.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Hora *</label>
              <select
                required
                value={selectedHour}
                onChange={e => setTimeStr(availableSlots.find(slot => slot.time_label.startsWith(`${e.target.value}:`))?.time_label || `${e.target.value}:00`)}
                disabled={loadingSlots || availableSlots.length === 0}
                className="w-full p-2.5 rounded-xl border border-slate-200 text-xs bg-white disabled:bg-slate-100"
              >
                {(() => {
                  const hoursWithSlots = Array.from(new Set(Array.from(availableTimes).map(t => t.slice(0, 2)))).sort();
                  const list = hoursWithSlots.length ? hoursWithSlots : [selectedHour];
                  return list.map(hour => <option key={hour} value={hour}>{hour}</option>);
                })()}
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Minutos *</label>
              <select
                required
                value={timeStr.slice(3, 5)}
                onChange={e => setTimeStr(`${selectedHour}:${e.target.value}`)}
                disabled={loadingSlots || availableSlots.length === 0}
                className="w-full p-2.5 rounded-xl border border-slate-200 text-xs bg-white disabled:bg-slate-100"
              >
                {[0, 15, 30, 45].map(minute => {
                  const value = String(minute).padStart(2, '0');
                  return <option key={value} value={value} disabled={!availableTimes.has(`${selectedHour}:${value}`)}>{value}</option>;
                })}
              </select>
            </div>
          </div>
          {loadingSlots && <p className="text-[11px] text-slate-400">Comprobando huecos disponibles…</p>}
          {!loadingSlots && dateStr && availableSlots.length === 0 && <p className="text-[11px] text-amber-700">No hay huecos disponibles en esa fecha para este tratamiento y odontólogo.</p>}

          <div>
            <label className="block font-bold text-slate-700 mb-1">Notas:</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Detalle o motivo..."
              className="w-full p-2.5 rounded-xl border border-slate-200 text-xs"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !availableTimes.has(timeStr)}
              className="bg-brand-600 hover:bg-brand-700 text-white font-bold px-5 py-2.5 rounded-xl transition"
            >
              {loading ? 'Guardando...' : 'Crear Cita'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
