'use client'

import { useMemo, useState, useTransition, useRef } from 'react'
import { moverTurno } from './actions'

type Estado = 'borrador' | 'confirmado' | 'cancelado' | 'completado' | 'no_asistio'

interface TurnoRaw {
  id: string
  inicio: string
  fin: string
  estado: Estado
  servicio: string
  duracionMinutos: number
  cliente: { nombre: string; telefono: string } | null
}

interface EventoExternoRaw {
  id: string
  inicio: string
  fin: string
  titulo: string | null
}

interface Dia {
  fechaLocal: string // YYYY-MM-DD
  inicioUtc: string  // 00:00 del día en UTC absoluto
  esHoy: boolean
}

interface Props {
  slug: string
  timezone: string
  dias: Dia[]
  horaInicio: number
  horaFin: number
  turnos: TurnoRaw[]
  eventosExternos: EventoExternoRaw[]
  excepcionesJson: string
}

const SLOT_MIN = 30 // altura de una celda = 30 min
const PX_POR_MIN = 1.2 // 30 min = 36px alto
const PX_POR_SLOT = SLOT_MIN * PX_POR_MIN

const ESTADO_COLOR: Record<Estado, { bg: string; border: string; text: string }> = {
  borrador: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
  confirmado: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
  cancelado: { bg: '#f3f4f6', border: '#9ca3af', text: '#4b5563' },
  completado: { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
  no_asistio: { bg: '#fce7f3', border: '#ec4899', text: '#9f1239' },
}

function formatHora(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
  })
}

function formatDiaHeader(iso: string, tz: string): { dia: string; fecha: string } {
  const d = new Date(iso)
  const dia = d.toLocaleDateString('es-AR', { weekday: 'short', timeZone: tz })
  const fecha = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: tz })
  return { dia, fecha }
}

/** Minuto local (0..1440) del inicio del turno, en el tz de la cuenta. */
function minutoLocal(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso))
  const m: Record<string, number> = {}
  for (const p of parts) if (p.type !== 'literal') m[p.type] = Number(p.value)
  if (m.hour === 24) m.hour = 0
  return m.hour * 60 + m.minute
}

/** Día calendario local (YYYY-MM-DD) del turno en el tz de la cuenta. */
function ymdLocal(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(iso))
  const m: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') m[p.type] = p.value
  return `${m.year}-${m.month}-${m.day}`
}

/** Instante UTC absoluto = `hh:mm` del día `ymd` en el tz. */
function ymdHmToUtc(ymd: string, hh: number, mm: number, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(guess))
  const map: Record<string, number> = {}
  for (const p of parts) if (p.type !== 'literal') map[p.type] = Number(p.value)
  if (map.hour === 24) map.hour = 0
  const diffMin =
    (map.year - y) * 525600 +
    (map.month - m) * 43800 +
    (map.day - d) * 1440 +
    (map.hour - hh) * 60 +
    (map.minute - mm)
  return new Date(guess - diffMin * 60_000)
}

export function SemanaGrid({ slug: _slug, timezone, dias, horaInicio, horaFin, turnos, eventosExternos }: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const draggingRef = useRef<{ turnoId: string; duracionMs: number } | null>(null)

  const filas = useMemo(() => {
    const out: number[] = []
    for (let h = horaInicio; h < horaFin; h++) {
      out.push(h * 60)
      out.push(h * 60 + 30)
    }
    return out
  }, [horaInicio, horaFin])

  // Index de turnos y externos por día calendario local
  const turnosPorDia = useMemo(() => {
    const map = new Map<string, TurnoRaw[]>()
    for (const t of turnos) {
      const k = ymdLocal(t.inicio, timezone)
      const arr = map.get(k) ?? []
      arr.push(t)
      map.set(k, arr)
    }
    return map
  }, [turnos, timezone])

  const externosPorDia = useMemo(() => {
    const map = new Map<string, EventoExternoRaw[]>()
    for (const e of eventosExternos) {
      const k = ymdLocal(e.inicio, timezone)
      const arr = map.get(k) ?? []
      arr.push(e)
      map.set(k, arr)
    }
    return map
  }, [eventosExternos, timezone])

  const onDragStart = (turnoId: string, duracionMs: number) => (ev: React.DragEvent) => {
    draggingRef.current = { turnoId, duracionMs }
    ev.dataTransfer.effectAllowed = 'move'
    // Chrome necesita algo en dataTransfer.
    ev.dataTransfer.setData('text/plain', turnoId)
  }

  const onDragEnd = () => {
    draggingRef.current = null
    setDragOverKey(null)
  }

  const onDragOver = (ymd: string, minutosDelDia: number) => (ev: React.DragEvent) => {
    if (!draggingRef.current) return
    ev.preventDefault()
    ev.dataTransfer.dropEffect = 'move'
    setDragOverKey(`${ymd}#${minutosDelDia}`)
  }

  const onDrop = (ymd: string, minutosDelDia: number) => (ev: React.DragEvent) => {
    ev.preventDefault()
    setDragOverKey(null)
    const drag = draggingRef.current
    if (!drag) return

    const nuevoInicio = ymdHmToUtc(ymd, Math.floor(minutosDelDia / 60), minutosDelDia % 60, timezone)
    setError(null)
    startTransition(async () => {
      const res = await moverTurno({
        turnoId: drag.turnoId,
        nuevoInicio: nuevoInicio.toISOString(),
      })
      if (!res.ok) setError(res.error ?? 'No se pudo mover el turno')
    })
  }

  const alturaTotal = filas.length * PX_POR_SLOT

  return (
    <div style={styles.wrapper}>
      {error && <div style={styles.errorBanner} role="alert">{error}</div>}
      {pending && <div style={styles.pendingBar}>Moviendo turno…</div>}

      <div style={styles.grid}>
        {/* Corner arriba-izq */}
        <div style={styles.cornerCell} />
        {/* Headers de días */}
        {dias.map((d) => {
          const { dia, fecha } = formatDiaHeader(d.inicioUtc, timezone)
          return (
            <div key={d.fechaLocal} style={{ ...styles.diaHeader, ...(d.esHoy ? styles.diaHeaderHoy : {}) }}>
              <div style={styles.diaHeaderNombre}>{dia}</div>
              <div style={styles.diaHeaderFecha}>{fecha}</div>
            </div>
          )
        })}

        {/* Columna de horas */}
        <div style={{ ...styles.colHoras, height: alturaTotal }}>
          {filas.map((mm, i) => (
            <div key={mm} style={{ ...styles.horaCell, top: i * PX_POR_SLOT }}>
              {mm % 60 === 0 && <span style={styles.horaLabel}>{String(Math.floor(mm / 60)).padStart(2, '0')}:00</span>}
            </div>
          ))}
        </div>

        {/* Columnas de días */}
        {dias.map((d) => {
          const turnosDelDia = turnosPorDia.get(d.fechaLocal) ?? []
          const externosDelDia = externosPorDia.get(d.fechaLocal) ?? []
          return (
            <div key={d.fechaLocal} style={{ ...styles.colDia, height: alturaTotal }}>
              {/* Celdas drop-target */}
              {filas.map((mm, i) => {
                const key = `${d.fechaLocal}#${mm}`
                const activa = dragOverKey === key
                return (
                  <div
                    key={mm}
                    style={{
                      ...styles.slot,
                      top: i * PX_POR_SLOT,
                      height: PX_POR_SLOT,
                      borderTop: mm % 60 === 0 ? '1px solid #d1d5db' : '1px dashed #e5e7eb',
                      background: activa ? '#e0f2fe' : undefined,
                    }}
                    onDragOver={onDragOver(d.fechaLocal, mm)}
                    onDrop={onDrop(d.fechaLocal, mm)}
                    onDragLeave={() => setDragOverKey(null)}
                  />
                )
              })}

              {/* Bloqueos externos (no draggable) */}
              {externosDelDia.map((e) => {
                const minutoInicio = minutoLocal(e.inicio, timezone)
                const minutoFin = minutoLocal(e.fin, timezone)
                // Sólo renderiza dentro del rango visible
                const inicioOffset = Math.max(0, minutoInicio - horaInicio * 60)
                const alto = Math.max(0, minutoFin - Math.max(minutoInicio, horaInicio * 60)) * PX_POR_MIN
                if (alto <= 0) return null
                return (
                  <div
                    key={e.id}
                    style={{
                      ...styles.externo,
                      top: inicioOffset * PX_POR_MIN,
                      height: alto,
                    }}
                    title={e.titulo ?? 'Bloqueo externo'}
                  >
                    🔒 {e.titulo ?? 'Ocupado'}
                  </div>
                )
              })}

              {/* Turnos */}
              {turnosDelDia.map((t) => {
                const minutoInicio = minutoLocal(t.inicio, timezone)
                const minutoFin = minutoLocal(t.fin, timezone)
                const inicioOffset = Math.max(0, minutoInicio - horaInicio * 60)
                const alto = Math.max(20, (minutoFin - minutoInicio) * PX_POR_MIN)
                const color = ESTADO_COLOR[t.estado]
                const cancelado = t.estado === 'cancelado'
                const draggable = t.estado === 'confirmado' || t.estado === 'borrador'
                const duracionMs = new Date(t.fin).getTime() - new Date(t.inicio).getTime()

                return (
                  <div
                    key={t.id}
                    draggable={draggable}
                    onDragStart={draggable ? onDragStart(t.id, duracionMs) : undefined}
                    onDragEnd={onDragEnd}
                    style={{
                      ...styles.turno,
                      top: inicioOffset * PX_POR_MIN,
                      height: alto,
                      background: color.bg,
                      borderLeft: `3px solid ${color.border}`,
                      color: color.text,
                      cursor: draggable ? 'grab' : 'default',
                      textDecoration: cancelado ? 'line-through' : 'none',
                      opacity: cancelado ? 0.6 : 1,
                    }}
                    title={`${formatHora(t.inicio, timezone)}–${formatHora(t.fin, timezone)} · ${t.cliente?.nombre ?? '(sin cliente)'} · ${t.servicio}`}
                  >
                    <div style={styles.turnoHora}>
                      {formatHora(t.inicio, timezone)}
                    </div>
                    <div style={styles.turnoCliente}>
                      {t.cliente?.nombre ?? '(sin cliente)'}
                    </div>
                    <div style={styles.turnoServicio}>{t.servicio}</div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      <div style={styles.hint}>
        Arrastrá un turno a otra celda para moverlo. La grilla se refresca
        automáticamente al soltar.
      </div>
    </div>
  )
}

const COL_HORA_W = 68
const COL_DIA_W = 140

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    padding: '1rem 1.5rem 3rem',
    overflowX: 'auto',
  },
  errorBanner: {
    background: '#fee2e2',
    border: '1px solid #fecaca',
    color: '#991b1b',
    padding: '0.75rem 1rem',
    borderRadius: 8,
    marginBottom: '0.5rem',
    fontSize: '0.875rem',
  },
  pendingBar: {
    background: '#dbeafe',
    color: '#1e40af',
    padding: '0.5rem 1rem',
    borderRadius: 8,
    marginBottom: '0.5rem',
    fontSize: '0.8125rem',
    textAlign: 'center',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: `${COL_HORA_W}px repeat(7, ${COL_DIA_W}px)`,
    gridTemplateRows: 'auto 1fr',
    background: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    minWidth: COL_HORA_W + 7 * COL_DIA_W,
  },
  cornerCell: {
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    borderRight: '1px solid #e5e7eb',
  },
  diaHeader: {
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    borderRight: '1px solid #e5e7eb',
    padding: '0.625rem 0.75rem',
    textAlign: 'center',
  },
  diaHeaderHoy: {
    background: '#eff6ff',
  },
  diaHeaderNombre: {
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    color: '#6b7280',
    letterSpacing: '0.05em',
    fontWeight: 600,
  },
  diaHeaderFecha: {
    fontSize: '1rem',
    color: '#111',
    fontWeight: 700,
    marginTop: '0.125rem',
  },
  colHoras: {
    position: 'relative',
    borderRight: '1px solid #e5e7eb',
    background: '#f9fafb',
  },
  horaCell: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: PX_POR_SLOT,
    padding: '0.125rem 0.5rem',
  },
  horaLabel: {
    fontSize: '0.7rem',
    color: '#6b7280',
    fontWeight: 500,
  },
  colDia: {
    position: 'relative',
    borderRight: '1px solid #e5e7eb',
  },
  slot: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  turno: {
    position: 'absolute',
    left: 2,
    right: 2,
    borderRadius: 4,
    padding: '0.25rem 0.5rem',
    fontSize: '0.75rem',
    overflow: 'hidden',
    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
    userSelect: 'none',
  },
  turnoHora: {
    fontWeight: 700,
    fontSize: '0.7rem',
  },
  turnoCliente: {
    fontWeight: 600,
    fontSize: '0.8125rem',
    marginTop: '0.125rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  turnoServicio: {
    fontSize: '0.7rem',
    opacity: 0.85,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  externo: {
    position: 'absolute',
    left: 2,
    right: 2,
    borderRadius: 4,
    padding: '0.25rem 0.5rem',
    background: 'repeating-linear-gradient(45deg, #f3f4f6 0 8px, #e5e7eb 8px 16px)',
    color: '#6b7280',
    fontSize: '0.7rem',
    fontWeight: 500,
    pointerEvents: 'none',
  },
  hint: {
    marginTop: '1rem',
    padding: '0.75rem 1rem',
    background: '#f9fafb',
    borderRadius: 8,
    color: '#6b7280',
    fontSize: '0.8125rem',
  },
}
