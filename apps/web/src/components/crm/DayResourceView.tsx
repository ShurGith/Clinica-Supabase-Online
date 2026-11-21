import React, { useMemo, useRef, useState } from 'react';

const PX_PER_MIN = 1.2;
const SNAP = 15;
const MIN_COL_WIDTH = 190;

type Range = [number, number];

interface Props {
  date: Date;
  professionals: any[];
  appointments: any[];
  profSchedules: any[];
  clinicWeek: any[];
  slotMinHour: number;
  slotMaxHour: number;
  selectedId?: string | null;
  paletteFor: (prof: any, idx: number) => { dot: string };
  renderAppointment: (appt: any) => React.ReactNode;
  onSelect: (appt: any) => void;
  onCreate: (prof: any, start: Date) => void;
  onBlocked: (prof: any, reason: string) => void;
  onMove: (appt: any, prof: any, start: Date, end: Date) => void;
  onResize: (appt: any, end: Date) => void;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

const intersect = (a: Range[], b: Range[]): Range[] => {
  const out: Range[] = [];
  for (const [f1, t1] of a) for (const [f2, t2] of b) {
    const f = Math.max(f1, f2), t = Math.min(t1, t2);
    if (f < t) out.push([f, t]);
  }
  return out;
};

const rangesOf = (open: string, close: string, bs?: string | null, be?: string | null): Range[] => {
  const o = toMin(open), c = toMin(close);
  if (bs && be && o < toMin(bs) && toMin(bs) < toMin(be) && toMin(be) < c) return [[o, toMin(bs)], [toMin(be), c]];
  return [[o, c]];
};

export const DayResourceView: React.FC<Props> = ({
  date, professionals, appointments, profSchedules, clinicWeek, slotMinHour, slotMaxHour,
  selectedId, paletteFor, renderAppointment, onSelect, onCreate, onBlocked, onMove, onResize,
}) => {
  const startMin = slotMinHour * 60;
  const endMin = slotMaxHour * 60;
  const height = (endMin - startMin) * PX_PER_MIN;
  const dow = date.getDay();
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  const [hover, setHover] = useState<{ profId: string; min: number } | null>(null);
  const [dropCol, setDropCol] = useState<string | null>(null);
  const [resizing, setResizing] = useState<{ id: string; end: number } | null>(null);
  const dragRef = useRef<{ id: string; offsetMin: number } | null>(null);

  const clinicRanges = useMemo<Range[]>(() => {
    const row = (clinicWeek || []).find((d: any) => d.day_of_week === dow);
    if (!row || row.is_closed) return [];
    return rangesOf(row.open_time, row.close_time, row.lunch_start, row.lunch_end);
  }, [clinicWeek, dow]);

  // Tramos en los que cada profesional atiende ese día (y el motivo si no atiende)
  const availability = useMemo(() => {
    const map: Record<string, { ranges: Range[]; reason: string }> = {};
    for (const p of professionals) {
      const managed = profSchedules.find((m: any) => m.id === p.id);
      if (!clinicRanges.length) { map[p.id] = { ranges: [], reason: 'La clínica está cerrada' }; continue; }
      if (!managed) { map[p.id] = { ranges: clinicRanges, reason: '' }; continue; }
      const day = (managed.schedules || []).find((d: any) => d.day_of_week === dow);
      if (!day || !day.is_working) { map[p.id] = { ranges: [], reason: 'No atiende hoy' }; continue; }
      const off = (managed.time_off || []).find((t: any) => ymd >= t.start_date && ymd <= t.end_date);
      if (off) { map[p.id] = { ranges: [], reason: off.reason || 'Ausencia' }; continue; }
      const ranges = intersect(clinicRanges, rangesOf(day.start_time, day.end_time, day.break_start, day.break_end));
      map[p.id] = { ranges, reason: ranges.length ? '' : 'No atiende hoy' };
    }
    return map;
  }, [professionals, profSchedules, clinicRanges, dow, ymd]);

  const dayAppts = useMemo(
    () => appointments.filter(a => a.start_time?.startsWith(ymd) || (a.start_time && new Date(a.start_time).toDateString() === date.toDateString())),
    [appointments, ymd, date],
  );

  const hours = Array.from({ length: slotMaxHour - slotMinHour }, (_, i) => slotMinHour + i);
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `64px repeat(${Math.max(professionals.length, 1)}, minmax(${MIN_COL_WIDTH}px, 1fr))`,
  };

  const yToMin = (e: React.MouseEvent | React.DragEvent, col: HTMLElement) => {
    const y = e.clientY - col.getBoundingClientRect().top;
    return startMin + y / PX_PER_MIN;
  };
  const snap = (m: number) => Math.round(m / SNAP) * SNAP;
  const floorSnap = (m: number) => Math.floor(m / SNAP) * SNAP;
  const at = (m: number) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setMinutes(m);
    return d;
  };
  const isFree = (p: any, from: number, to: number) =>
    availability[p.id]?.ranges.some(([f, t]) => from >= f && to <= t);

  const startResize = (e: React.MouseEvent, appt: any) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const s = minutesOf(new Date(appt.start_time));
    const baseEnd = minutesOf(new Date(appt.end_time));
    let current = baseEnd;
    const move = (ev: MouseEvent) => {
      current = Math.max(s + SNAP, snap(baseEnd + (ev.clientY - startY) / PX_PER_MIN));
      setResizing({ id: appt.id, end: current });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setResizing(null);
      if (current !== baseEnd) onResize(appt, at(current));
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const nowMin = new Date().toDateString() === date.toDateString() ? minutesOf(new Date()) : null;

  return (
    <div className="overflow-x-auto">
      <div className="grid" style={gridStyle}>
        {/* Cabecera */}
        <div className="border-b border-stone-200 bg-[#fbf9f4]" />
        {professionals.map((p, idx) => {
          const av = availability[p.id];
          const count = dayAppts.filter(a => a.professional_id === p.id).length;
          const span = av?.ranges.length ? `${fmt(av.ranges[0][0])}–${fmt(av.ranges[av.ranges.length - 1][1])}` : '';
          return (
            <div key={p.id} className="px-3 py-2.5 border-b border-l border-stone-200 bg-[#fbf9f4] min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-stone-900 truncate">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: paletteFor(p, idx).dot }} />
                <span className="truncate">{p.first_name} {p.last_name}</span>
              </div>
              <div className="text-[11px] text-stone-500 mt-0.5">
                {av?.ranges.length ? `${span} · ${count} ${count === 1 ? 'cita' : 'citas'}` : av?.reason || 'No atiende hoy'}
              </div>
            </div>
          );
        })}

        {/* Eje horario */}
        <div className="relative" style={{ height }}>
          {hours.map(h => (
            <div
              key={h}
              className="absolute right-2 -translate-y-1/2 text-[10px] font-medium text-stone-500"
              style={{ top: (h * 60 - startMin) * PX_PER_MIN + (h === slotMinHour ? 8 : 0) }}
            >
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* Columnas */}
        {professionals.map(p => {
          const av = availability[p.id];
          const gaps: Range[] = [];
          let cursor = startMin;
          for (const [f, t] of [...(av?.ranges || [])].sort((a, b) => a[0] - b[0])) {
            if (f > cursor) gaps.push([cursor, Math.min(f, endMin)]);
            cursor = Math.max(cursor, t);
          }
          if (cursor < endMin) gaps.push([cursor, endMin]);
          const colAppts = dayAppts.filter(a => a.professional_id === p.id);
          const ghost = hover && hover.profId === p.id ? hover.min : null;

          return (
            <div
              key={p.id}
              className={`relative border-l border-stone-200 ${dropCol === p.id ? 'bg-emerald-50/60' : ''}`}
              style={{
                height,
                backgroundImage:
                  `repeating-linear-gradient(to bottom, #ebe7dd 0, #ebe7dd 1px, transparent 1px, transparent ${60 * PX_PER_MIN}px),` +
                  `repeating-linear-gradient(to bottom, transparent 0, transparent ${30 * PX_PER_MIN - 1}px, #f1eee6 ${30 * PX_PER_MIN - 1}px, #f1eee6 ${30 * PX_PER_MIN}px)`,
              }}
              onMouseMove={e => {
                if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.bg) { setHover(null); return; }
                const m = floorSnap(yToMin(e, e.currentTarget));
                const busy = colAppts.some(a => minutesOf(new Date(a.start_time)) < m + SNAP && minutesOf(new Date(a.end_time)) > m);
                setHover(!busy && isFree(p, m, m + SNAP) ? { profId: p.id, min: m } : null);
              }}
              onMouseLeave={() => setHover(null)}
              onClick={e => {
                if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.bg) return;
                const m = floorSnap(yToMin(e, e.currentTarget));
                if (!isFree(p, m, m + SNAP)) {
                  onBlocked(p, av?.reason || 'Ese tramo queda fuera de su horario.');
                  return;
                }
                onCreate(p, at(m));
              }}
              onDragOver={e => { e.preventDefault(); setDropCol(p.id); }}
              onDragLeave={() => setDropCol(null)}
              onDrop={e => {
                e.preventDefault();
                setDropCol(null);
                const drag = dragRef.current;
                dragRef.current = null;
                if (!drag) return;
                const appt = appointments.find(a => a.id === drag.id);
                if (!appt) return;
                const dur = minutesOf(new Date(appt.end_time)) - minutesOf(new Date(appt.start_time));
                const m = Math.max(startMin, snap(yToMin(e, e.currentTarget) - drag.offsetMin));
                onMove(appt, p, at(m), at(m + dur));
              }}
            >
              {gaps.map(([f, t], i) => (
                <div
                  key={i}
                  data-bg="1"
                  className="absolute inset-x-0"
                  style={{
                    top: (f - startMin) * PX_PER_MIN,
                    height: (t - f) * PX_PER_MIN,
                    background: 'repeating-linear-gradient(-45deg, rgba(120,113,108,0.14) 0 6px, rgba(120,113,108,0.32) 6px 8px)',
                  }}
                />
              ))}

              {!av?.ranges.length && (
                <div className="absolute inset-x-0 top-1/3 text-center text-xs text-stone-500 pointer-events-none">
                  {av?.reason || 'No atiende'}
                </div>
              )}

              {ghost !== null && (
                <div
                  className="absolute inset-x-1 rounded-md border border-dashed border-[#2f6b46] bg-[#e6f0e0] text-[#1f5c3f] text-[11px] font-bold px-2 py-1 pointer-events-none z-10"
                  style={{ top: (ghost - startMin) * PX_PER_MIN, height: 30 * PX_PER_MIN }}
                >
                  + {fmt(ghost)}
                </div>
              )}

              {colAppts.map(a => {
                const s = minutesOf(new Date(a.start_time));
                const e = resizing && resizing.id === a.id ? resizing.end : minutesOf(new Date(a.end_time));
                return (
                  <div
                    key={a.id}
                    draggable={!resizing}
                    onDragStart={ev => {
                      const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                      dragRef.current = { id: a.id, offsetMin: (ev.clientY - r.top) / PX_PER_MIN };
                      ev.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => { dragRef.current = null; setDropCol(null); }}
                    onClick={ev => { ev.stopPropagation(); onSelect(a); }}
                    className={`absolute inset-x-1 z-20 cursor-pointer ${selectedId === a.id ? 'z-30' : ''}`}
                    style={{ top: (s - startMin) * PX_PER_MIN, height: Math.max((e - s) * PX_PER_MIN - 2, 22) }}
                  >
                    {renderAppointment(a)}
                    <div
                      onMouseDown={ev => startResize(ev, a)}
                      draggable={false}
                      className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                    />
                  </div>
                );
              })}

              {nowMin !== null && nowMin >= startMin && nowMin <= endMin && (
                <div
                  className="absolute inset-x-0 z-30 pointer-events-none border-t-[1.5px] border-[#b4694f]"
                  style={{ top: (nowMin - startMin) * PX_PER_MIN }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
