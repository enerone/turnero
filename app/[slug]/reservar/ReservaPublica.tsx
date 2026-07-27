'use client'

import { useState, useEffect, useCallback } from 'react'

interface Cuenta {
  id: string
  slug: string
  nombrePublico: string
  color: string
  timezone: string
  telefonoWhatsapp: string | null
}

interface Servicio {
  id: string
  nombre: string
  duracionMinutos: number
  esDefault: boolean
}

interface Slot {
  inicio: string
  fin: string
  servicioId: string
  servicioNombre: string
  duracionMinutos: number
}

interface Props {
  cuenta: Cuenta
  servicios: Servicio[]
}

type Paso = 'servicio' | 'fecha' | 'horario' | 'datos' | 'confirmando' | 'exito'

function toISODate(fecha: Date): string {
  const yyyy = fecha.getFullYear()
  const mm = String(fecha.getMonth() + 1).padStart(2, '0')
  const dd = String(fecha.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function formatFecha(fecha: Date, tz: string): string {
  return fecha.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz })
}

function formatHora(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: tz })
}

export function ReservaPublica({ cuenta, servicios }: Props) {
  const [paso, setPaso] = useState<Paso>('servicio')
  const [servicioSel, setServicioSel] = useState<Servicio | null>(null)
  const [fechaSel, setFechaSel] = useState<Date | null>(null)
  const [horarioSel, setHorarioSel] = useState<Slot | null>(null)
  const [disponibilidad, setDisponibilidad] = useState<Map<string, Slot[]>>(new Map())
  const [cargando, setCargando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  const cargarDisponibilidad = useCallback(async () => {
    if (!servicioSel) return
    setCargando(true)
    setError(null)
    try {
      const desde = new Date(hoy)
      const hasta = new Date(hoy)
      hasta.setDate(hoy.getDate() + 13)
      const url = `/${cuenta.slug}/api/reservar/disponibilidad?servicioId=${servicioSel.id}&desde=${toISODate(desde)}&hasta=${toISODate(hasta)}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Error cargando horarios')
      const data = await res.json() as { disponibilidad: Array<{ fecha: string; slots: Slot[] }> }
      const map = new Map<string, Slot[]>()
      for (const dia of data.disponibilidad) {
        map.set(toISODate(new Date(dia.fecha)), dia.slots)
      }
      setDisponibilidad(map)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos cargar los horarios')
    } finally {
      setCargando(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicioSel?.id, cuenta.slug])

  useEffect(() => {
    if (paso === 'fecha' || paso === 'horario') cargarDisponibilidad()
  }, [paso, cargarDisponibilidad])

  const slotsDelDia = fechaSel ? disponibilidad.get(toISODate(fechaSel)) ?? [] : []

  const handleConfirmar = async () => {
    if (!servicioSel || !horarioSel) return
    if (!nombre.trim() || !telefono.trim()) {
      setError('Completá nombre y teléfono')
      return
    }
    setEnviando(true)
    setError(null)
    setPaso('confirmando')
    try {
      const res = await fetch(`/${cuenta.slug}/api/reservar/crear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          servicioId: servicioSel.id,
          inicio: horarioSel.inicio,
          fin: horarioSel.fin,
          cliente: { nombre: nombre.trim(), telefono: telefono.trim(), email: email.trim() || undefined },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al reservar')
      setPaso('exito')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
      setPaso('datos')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={styles.wrapper}>
      <nav style={styles.progress} aria-label="Pasos de la reserva">
        {(['servicio', 'fecha', 'horario', 'datos'] as const).map((p, i) => {
          const activo = (['servicio', 'fecha', 'horario', 'datos'] as string[]).indexOf(paso) >= i
          return (
            <div key={p} style={{ ...styles.step, ...(activo ? styles.stepActive : {}) }}>
              <span style={styles.stepNumber}>{i + 1}</span>
              <span>{p === 'servicio' ? 'Servicio' : p === 'fecha' ? 'Día' : p === 'horario' ? 'Hora' : 'Datos'}</span>
            </div>
          )
        })}
      </nav>

      {error && <div style={styles.error}>{error}</div>}

      {paso === 'servicio' && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>¿Qué servicio?</h2>
          <div style={styles.serviciosGrid}>
            {servicios.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { setServicioSel(s); setPaso('fecha') }}
                style={{
                  ...styles.servicioCard,
                  ...(servicioSel?.id === s.id ? styles.servicioCardSelected : {}),
                }}
              >
                <strong>{s.nombre}</strong>
                <span style={styles.servicioDuracion}>{s.duracionMinutos} min</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {paso === 'fecha' && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Elegí un día</h2>
          {cargando ? (
            <div style={styles.loading}>Cargando horarios…</div>
          ) : (
            <div style={styles.calendario}>
              {Array.from({ length: 14 }).map((_, i) => {
                const dia = new Date(hoy)
                dia.setDate(hoy.getDate() + i)
                const key = toISODate(dia)
                const haySlots = (disponibilidad.get(key) ?? []).length > 0
                const esHoy = isSameDay(dia, hoy)
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!haySlots}
                    onClick={() => { setFechaSel(dia); setPaso('horario') }}
                    style={{
                      ...styles.diaBtn,
                      ...(haySlots ? {} : styles.diaBtnDisabled),
                      ...(fechaSel && isSameDay(fechaSel, dia) ? styles.diaBtnSelected : {}),
                      ...(esHoy ? styles.diaBtnToday : {}),
                    }}
                    aria-disabled={!haySlots}
                  >
                    <span style={styles.diaNum}>{dia.getDate()}</span>
                    <span style={styles.diaSemana}>{dia.toLocaleDateString('es-AR', { weekday: 'short' })}</span>
                    {!haySlots && <span style={styles.diaSinHorarios}>—</span>}
                  </button>
                )
              })}
            </div>
          )}
          <button type="button" onClick={() => setPaso('servicio')} style={styles.btnBack}>Volver</button>
        </section>
      )}

      {paso === 'horario' && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Elegí la hora</h2>
          <p style={styles.resumen}>{fechaSel && formatFecha(fechaSel, cuenta.timezone)}</p>
          {cargando ? (
            <div style={styles.loading}>Cargando…</div>
          ) : slotsDelDia.length === 0 ? (
            <p style={styles.empty}>No hay horarios disponibles este día.</p>
          ) : (
            <div style={styles.horariosGrid}>
              {slotsDelDia.map((slot) => (
                <button
                  key={slot.inicio}
                  type="button"
                  onClick={() => { setHorarioSel(slot); setPaso('datos') }}
                  style={{
                    ...styles.horarioBtn,
                    ...(horarioSel?.inicio === slot.inicio ? styles.horarioBtnSelected : {}),
                  }}
                >
                  {formatHora(slot.inicio, cuenta.timezone)}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => setPaso('fecha')} style={styles.btnBack}>Volver</button>
        </section>
      )}

      {paso === 'datos' && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Tus datos</h2>
          <p style={styles.resumen}>
            <strong>{servicioSel?.nombre}</strong>
            {fechaSel && ` · ${formatFecha(fechaSel, cuenta.timezone)}`}
            {horarioSel && ` a las ${formatHora(horarioSel.inicio, cuenta.timezone)}`}
          </p>
          <div style={styles.formGroup}>
            <label htmlFor="nombre" style={styles.label}>Nombre *</label>
            <input
              id="nombre"
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Tu nombre"
              style={styles.input}
              autoComplete="name"
              required
            />
          </div>
          <div style={styles.formGroup}>
            <label htmlFor="telefono" style={styles.label}>Teléfono (WhatsApp) *</label>
            <input
              id="telefono"
              type="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="+54 9 11 0000 0000"
              style={styles.input}
              autoComplete="tel"
              required
            />
          </div>
          <div style={styles.formGroup}>
            <label htmlFor="email" style={styles.label}>Email (opcional)</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              autoComplete="email"
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button type="button" onClick={() => setPaso('horario')} style={styles.btnBack}>Volver</button>
            <button
              type="button"
              onClick={handleConfirmar}
              disabled={enviando}
              style={{ ...styles.btnPrimary, ...(enviando ? styles.btnDisabled : {}) }}
            >
              {enviando ? 'Reservando…' : 'Reservar'}
            </button>
          </div>
        </section>
      )}

      {paso === 'confirmando' && (
        <section style={styles.section}>
          <p style={styles.confirmando}>Reservando tu turno…</p>
        </section>
      )}

      {paso === 'exito' && (
        <section style={styles.section}>
          <div style={styles.successIcon}>✓</div>
          <h2 style={styles.successTitle}>¡Reserva creada!</h2>
          <p style={styles.successText}>
            Te enviamos un link para confirmar el turno al WhatsApp {telefono}.
            <br />
            El link expira en 30 minutos.
          </p>
        </section>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    background: '#fff',
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    overflow: 'hidden',
  },
  progress: {
    display: 'flex',
    justifyContent: 'space-around',
    padding: '1rem',
    background: '#f8f9fa',
    borderBottom: '1px solid #eee',
  },
  step: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    color: '#999',
    fontSize: '0.7rem',
    fontWeight: 500,
    textTransform: 'uppercase',
  },
  stepActive: { color: '#0ea5e9' },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: '#eee',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.75rem',
    fontWeight: 600,
  },
  error: {
    margin: '1rem',
    padding: '0.75rem',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    color: '#b91c1c',
    fontSize: '0.875rem',
  },
  section: { padding: '1.5rem' },
  sectionTitle: { margin: '0 0 1rem', fontSize: '1.125rem', fontWeight: 600 },
  serviciosGrid: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  servicioCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#fff',
    textAlign: 'left',
    fontSize: '1rem',
    cursor: 'pointer',
  },
  servicioCardSelected: { borderColor: '#0ea5e9', background: '#eff6ff' },
  servicioDuracion: { color: '#666', fontSize: '0.875rem' },
  calendario: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '0.5rem',
    marginBottom: '1rem',
  },
  diaBtn: {
    aspectRatio: '1',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#fff',
    fontSize: '0.875rem',
    cursor: 'pointer',
  },
  diaBtnDisabled: { opacity: 0.4, cursor: 'not-allowed', color: '#999' },
  diaBtnSelected: { borderColor: '#0ea5e9', background: '#eff6ff', color: '#0ea5e9' },
  diaBtnToday: { fontWeight: 600 },
  diaNum: { fontSize: '1.125rem', fontWeight: 600 },
  diaSemana: { fontSize: '0.7rem', textTransform: 'uppercase' },
  diaSinHorarios: { fontSize: '0.65rem', color: '#999' },
  horariosGrid: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' },
  horarioBtn: {
    padding: '0.75rem 1rem',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#fff',
    cursor: 'pointer',
    fontSize: '0.9375rem',
  },
  horarioBtnSelected: { borderColor: '#0ea5e9', background: '#eff6ff', color: '#0ea5e9' },
  formGroup: { marginBottom: '1rem' },
  label: { display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: 4, color: '#333' },
  input: {
    width: '100%',
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    fontSize: '1rem',
    boxSizing: 'border-box',
  },
  resumen: { marginBottom: '1rem', color: '#444', fontSize: '0.9375rem' },
  btnBack: {
    padding: '0.75rem 1.5rem',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    background: '#fff',
    color: '#374151',
    fontWeight: 500,
    cursor: 'pointer',
  },
  btnPrimary: {
    flex: 1,
    padding: '0.75rem 1.5rem',
    border: 'none',
    borderRadius: 8,
    background: '#0ea5e9',
    color: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: '1rem',
  },
  btnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  loading: { textAlign: 'center', color: '#666', padding: '2rem' },
  empty: { textAlign: 'center', color: '#666', padding: '2rem' },
  confirmando: { textAlign: 'center', color: '#666', padding: '1rem' },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: '#dcfce7',
    color: '#16a34a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '2rem',
    margin: '0 auto 1rem',
  },
  successTitle: { textAlign: 'center', margin: '0 0 0.5rem', fontSize: '1.25rem' },
  successText: { textAlign: 'center', color: '#444', lineHeight: 1.5 },
}
