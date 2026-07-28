'use client'

import { useState, useTransition } from 'react'
import {
  crearServicio, actualizarServicio,
  reemplazarHorariosSemanales,
  crearExcepcion, borrarExcepcion,
  actualizarCuenta,
  type AccionResult,
} from './actions'

interface Servicio {
  id: string
  nombre: string
  duracionMinutos: number
  esDefault: boolean
  permiteSobreturnos: boolean
  activo: boolean
}

interface Franja {
  diaSemana: number
  desde: string // HH:MM
  hasta: string
}

interface Excepcion {
  id: string
  fecha: string // YYYY-MM-DD
  tipo: 'cerrado' | 'horario_especial'
  desde: string | null
  hasta: string | null
  motivo: string
}

interface CuentaInfo {
  nombrePublico: string
  telefonoWhatsapp: string | null
  color: string
  ubicacion: string | null
  timezone: string
}

interface Props {
  slug: string
  puedeEditar: boolean
  cuenta: CuentaInfo
  servicios: Servicio[]
  franjas: Franja[]
  excepciones: Excepcion[]
}

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

export function ConfigCliente({ slug: _slug, puedeEditar, cuenta, servicios, franjas, excepciones }: Props) {
  return (
    <div style={styles.wrap}>
      <SeccionCuenta cuenta={cuenta} puedeEditar={puedeEditar} />
      <SeccionServicios servicios={servicios} puedeEditar={puedeEditar} />
      <SeccionHorarios franjas={franjas} puedeEditar={puedeEditar} />
      <SeccionExcepciones excepciones={excepciones} puedeEditar={puedeEditar} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// SECCIÓN CUENTA
// ─────────────────────────────────────────────────────────────

function SeccionCuenta({ cuenta, puedeEditar }: { cuenta: CuentaInfo; puedeEditar: boolean }) {
  const [nombrePublico, setNombrePublico] = useState(cuenta.nombrePublico)
  const [telefono, setTelefono] = useState(cuenta.telefonoWhatsapp ?? '')
  const [color, setColor] = useState(cuenta.color)
  const [ubicacion, setUbicacion] = useState(cuenta.ubicacion ?? '')
  const [feedback, setFeedback] = useState<AccionResult | null>(null)
  const [pending, startTransition] = useTransition()

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFeedback(null)
    startTransition(async () => {
      const res = await actualizarCuenta({
        nombrePublico, telefonoWhatsapp: telefono, color, ubicacion,
      })
      setFeedback(res)
    })
  }

  return (
    <Card titulo="Cuenta" descripcion="Datos que se muestran en tu página pública de reserva.">
      <form onSubmit={onSubmit}>
        <Field label="Nombre público">
          <input style={styles.input} value={nombrePublico} onChange={(e) => setNombrePublico(e.target.value)} disabled={!puedeEditar || pending} required maxLength={120} />
        </Field>
        <Field label="Teléfono WhatsApp" hint="Se usa para avisos al dueño (cancelaciones). E.164, ej: +54 9 11 4567 8900.">
          <input style={styles.input} value={telefono} onChange={(e) => setTelefono(e.target.value)} disabled={!puedeEditar || pending} placeholder="+54 9 11 ..." maxLength={30} />
        </Field>
        <Field label="Ubicación" hint="Aparece bajo el nombre en la página pública.">
          <input style={styles.input} value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} disabled={!puedeEditar || pending} maxLength={200} />
        </Field>
        <Field label="Color de marca">
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} disabled={!puedeEditar || pending} style={{ width: 44, height: 32, border: '1px solid #d1d5db', borderRadius: 6 }} />
            <input style={{ ...styles.input, maxWidth: 120 }} value={color} onChange={(e) => setColor(e.target.value)} disabled={!puedeEditar || pending} pattern="^#[0-9a-fA-F]{6}$" />
          </div>
        </Field>
        <Field label="Zona horaria" hint="Fijada en el onboarding. Cambio requiere migración manual (contactar soporte).">
          <input style={styles.input} value={cuenta.timezone} disabled readOnly />
        </Field>
        {feedback && <Feedback res={feedback} />}
        {puedeEditar && (
          <button style={styles.btnPrimario} type="submit" disabled={pending}>
            {pending ? 'Guardando…' : 'Guardar cambios'}
          </button>
        )}
      </form>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────
// SECCIÓN SERVICIOS
// ─────────────────────────────────────────────────────────────

function SeccionServicios({ servicios, puedeEditar }: { servicios: Servicio[]; puedeEditar: boolean }) {
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevaDuracion, setNuevaDuracion] = useState(30)
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<AccionResult | null>(null)

  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [editNombre, setEditNombre] = useState('')
  const [editDuracion, setEditDuracion] = useState(30)

  const iniciarEdicion = (s: Servicio) => {
    setEditandoId(s.id)
    setEditNombre(s.nombre)
    setEditDuracion(s.duracionMinutos)
    setFeedback(null)
  }

  const cancelarEdicion = () => setEditandoId(null)

  const guardarEdicion = (s: Servicio) => {
    setFeedback(null)
    startTransition(async () => {
      const res = await actualizarServicio({
        id: s.id, nombre: editNombre, duracionMinutos: editDuracion,
      })
      setFeedback(res)
      if (res.ok) setEditandoId(null)
    })
  }

  const toggleActivo = (s: Servicio) => {
    setFeedback(null)
    startTransition(async () => {
      const res = await actualizarServicio({ id: s.id, activo: !s.activo })
      setFeedback(res)
    })
  }

  const marcarDefault = (s: Servicio) => {
    setFeedback(null)
    startTransition(async () => {
      const res = await actualizarServicio({ id: s.id, esDefault: true })
      setFeedback(res)
    })
  }

  const crear = (e: React.FormEvent) => {
    e.preventDefault()
    setFeedback(null)
    startTransition(async () => {
      const res = await crearServicio({ nombre: nuevoNombre, duracionMinutos: nuevaDuracion })
      setFeedback(res)
      if (res.ok) {
        setNuevoNombre('')
        setNuevaDuracion(30)
      }
    })
  }

  return (
    <Card titulo="Servicios" descripcion="Cada servicio define su duración. El default es el que se preselecciona en la reserva pública.">
      <ul style={styles.lista}>
        {servicios.map((s) => (
          <li key={s.id} style={{ ...styles.itemServicio, opacity: s.activo ? 1 : 0.5 }}>
            {editandoId === s.id ? (
              <div style={{ flex: 1, display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input style={{ ...styles.input, flex: 1, minWidth: 160 }} value={editNombre} onChange={(e) => setEditNombre(e.target.value)} disabled={pending} />
                <input style={{ ...styles.input, width: 90 }} type="number" min={5} max={480} step={5} value={editDuracion} onChange={(e) => setEditDuracion(Number(e.target.value))} disabled={pending} />
                <button style={styles.btnPequeño} type="button" onClick={() => guardarEdicion(s)} disabled={pending}>Guardar</button>
                <button style={{ ...styles.btnPequeño, ...styles.btnPequeñoGhost }} type="button" onClick={cancelarEdicion} disabled={pending}>Cancelar</button>
              </div>
            ) : (
              <>
                <div style={{ flex: 1 }}>
                  <div style={styles.servicioNombre}>
                    {s.nombre}
                    {s.esDefault && <span style={styles.badge}>Default</span>}
                    {!s.activo && <span style={{ ...styles.badge, background: '#f3f4f6', color: '#6b7280' }}>Inactivo</span>}
                  </div>
                  <div style={styles.servicioMeta}>{s.duracionMinutos} min</div>
                </div>
                {puedeEditar && (
                  <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                    {!s.esDefault && s.activo && (
                      <button style={styles.btnPequeño} type="button" onClick={() => marcarDefault(s)} disabled={pending}>★ Default</button>
                    )}
                    <button style={styles.btnPequeño} type="button" onClick={() => iniciarEdicion(s)} disabled={pending}>Editar</button>
                    <button style={{ ...styles.btnPequeño, ...styles.btnPequeñoDanger }} type="button" onClick={() => toggleActivo(s)} disabled={pending}>
                      {s.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {puedeEditar && (
        <form onSubmit={crear} style={styles.formNuevo}>
          <input style={{ ...styles.input, flex: 1, minWidth: 160 }} placeholder="Nombre del servicio" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} required maxLength={80} disabled={pending} />
          <input style={{ ...styles.input, width: 100 }} type="number" min={5} max={480} step={5} value={nuevaDuracion} onChange={(e) => setNuevaDuracion(Number(e.target.value))} disabled={pending} />
          <span style={{ alignSelf: 'center', color: '#6b7280', fontSize: '0.8125rem' }}>min</span>
          <button style={styles.btnPrimario} type="submit" disabled={pending}>{pending ? '…' : '+ Agregar'}</button>
        </form>
      )}
      {feedback && <Feedback res={feedback} />}
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────
// SECCIÓN HORARIOS
// ─────────────────────────────────────────────────────────────

function SeccionHorarios({ franjas: franjasInit, puedeEditar }: { franjas: Franja[]; puedeEditar: boolean }) {
  const [franjas, setFranjas] = useState<Franja[]>(franjasInit)
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<AccionResult | null>(null)

  const franjasPorDia = (dow: number) => franjas.filter((f) => f.diaSemana === dow).map((f, i) => ({ ...f, _idx: i }))

  const actualizarFranja = (diaSemana: number, idx: number, campo: 'desde' | 'hasta', valor: string) => {
    let count = -1
    setFranjas(franjas.map((f) => {
      if (f.diaSemana !== diaSemana) return f
      count += 1
      if (count === idx) return { ...f, [campo]: valor }
      return f
    }))
  }

  const agregarFranja = (dow: number) => {
    setFranjas([...franjas, { diaSemana: dow, desde: '09:00', hasta: '13:00' }])
  }

  const quitarFranja = (dow: number, idx: number) => {
    let count = -1
    setFranjas(franjas.filter((f) => {
      if (f.diaSemana !== dow) return true
      count += 1
      return count !== idx
    }))
  }

  const guardar = () => {
    setFeedback(null)
    startTransition(async () => {
      const res = await reemplazarHorariosSemanales({ franjas })
      setFeedback(res)
    })
  }

  return (
    <Card titulo="Horarios semanales" descripcion="Franjas de atención por día. Podés agregar varias (por ejemplo, mañana y tarde).">
      <table style={styles.tabla}>
        <tbody>
          {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
            const franjasDia = franjasPorDia(dow)
            return (
              <tr key={dow}>
                <td style={styles.tdDia}>{DIAS[dow]}</td>
                <td>
                  {franjasDia.length === 0 && (
                    <span style={styles.diaSinHorario}>Cerrado</span>
                  )}
                  {franjasDia.map((f) => (
                    <div key={f._idx} style={styles.filaFranja}>
                      <input style={{ ...styles.input, width: 88 }} type="time" value={f.desde} onChange={(e) => actualizarFranja(dow, f._idx, 'desde', e.target.value)} disabled={!puedeEditar || pending} />
                      <span style={{ color: '#6b7280' }}>a</span>
                      <input style={{ ...styles.input, width: 88 }} type="time" value={f.hasta} onChange={(e) => actualizarFranja(dow, f._idx, 'hasta', e.target.value)} disabled={!puedeEditar || pending} />
                      {puedeEditar && (
                        <button style={styles.btnIcono} type="button" onClick={() => quitarFranja(dow, f._idx)} aria-label="Quitar franja">×</button>
                      )}
                    </div>
                  ))}
                  {puedeEditar && (
                    <button style={styles.btnGhostPequeño} type="button" onClick={() => agregarFranja(dow)} disabled={pending}>
                      + Agregar franja
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {feedback && <Feedback res={feedback} />}
      {puedeEditar && (
        <button style={styles.btnPrimario} type="button" onClick={guardar} disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar horarios'}
        </button>
      )}
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────
// SECCIÓN EXCEPCIONES
// ─────────────────────────────────────────────────────────────

function SeccionExcepciones({ excepciones, puedeEditar }: { excepciones: Excepcion[]; puedeEditar: boolean }) {
  const [fecha, setFecha] = useState('')
  const [tipo, setTipo] = useState<'cerrado' | 'horario_especial'>('cerrado')
  const [desde, setDesde] = useState('09:00')
  const [hasta, setHasta] = useState('13:00')
  const [motivo, setMotivo] = useState('')
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<AccionResult | null>(null)

  const crear = (e: React.FormEvent) => {
    e.preventDefault()
    setFeedback(null)
    startTransition(async () => {
      const res = await crearExcepcion({
        fecha, tipo, motivo,
        ...(tipo === 'horario_especial' ? { desde, hasta } : {}),
      })
      setFeedback(res)
      if (res.ok) {
        setFecha('')
        setMotivo('')
        setTipo('cerrado')
      }
    })
  }

  const borrar = (id: string) => {
    setFeedback(null)
    startTransition(async () => {
      const res = await borrarExcepcion({ id })
      setFeedback(res)
    })
  }

  return (
    <Card titulo="Excepciones" descripcion="Feriados, vacaciones y horarios especiales. Se muestran las próximas.">
      {excepciones.length === 0 ? (
        <p style={styles.emptyHint}>No hay excepciones cargadas.</p>
      ) : (
        <ul style={styles.lista}>
          {excepciones.map((e) => (
            <li key={e.id} style={styles.itemServicio}>
              <div style={{ flex: 1 }}>
                <div style={styles.servicioNombre}>
                  {e.fecha}
                  <span style={{ ...styles.badge, background: e.tipo === 'cerrado' ? '#fee2e2' : '#dbeafe', color: e.tipo === 'cerrado' ? '#991b1b' : '#1e40af' }}>
                    {e.tipo === 'cerrado' ? 'Cerrado' : `${e.desde} – ${e.hasta}`}
                  </span>
                </div>
                {e.motivo && <div style={styles.servicioMeta}>{e.motivo}</div>}
              </div>
              {puedeEditar && (
                <button style={{ ...styles.btnPequeño, ...styles.btnPequeñoDanger }} type="button" onClick={() => borrar(e.id)} disabled={pending}>
                  Borrar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {puedeEditar && (
        <form onSubmit={crear} style={{ ...styles.formNuevo, flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input style={{ ...styles.input, minWidth: 140 }} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required disabled={pending} />
            <select style={{ ...styles.input, minWidth: 140 }} value={tipo} onChange={(e) => setTipo(e.target.value as 'cerrado' | 'horario_especial')} disabled={pending}>
              <option value="cerrado">Cerrado</option>
              <option value="horario_especial">Horario especial</option>
            </select>
            {tipo === 'horario_especial' && (
              <>
                <input style={{ ...styles.input, width: 90 }} type="time" value={desde} onChange={(e) => setDesde(e.target.value)} required disabled={pending} />
                <span style={{ alignSelf: 'center', color: '#6b7280' }}>a</span>
                <input style={{ ...styles.input, width: 90 }} type="time" value={hasta} onChange={(e) => setHasta(e.target.value)} required disabled={pending} />
              </>
            )}
          </div>
          <input style={styles.input} placeholder="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} disabled={pending} />
          <button style={styles.btnPrimario} type="submit" disabled={pending}>{pending ? '…' : '+ Agregar excepción'}</button>
        </form>
      )}
      {feedback && <Feedback res={feedback} />}
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────
// UI primitives
// ─────────────────────────────────────────────────────────────

function Card({ titulo, descripcion, children }: { titulo: string; descripcion?: string; children: React.ReactNode }) {
  return (
    <section style={styles.card}>
      <div style={styles.cardHeader}>
        <h2 style={styles.cardTitle}>{titulo}</h2>
        {descripcion && <p style={styles.cardDesc}>{descripcion}</p>}
      </div>
      <div style={styles.cardBody}>{children}</div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={styles.field}>
      <label style={styles.label}>{label}</label>
      {children}
      {hint && <div style={styles.hint}>{hint}</div>}
    </div>
  )
}

function Feedback({ res }: { res: AccionResult }) {
  return (
    <div style={res.ok ? styles.feedbackOk : styles.feedbackErr}>
      {res.ok ? 'Guardado.' : (res.error ?? 'Ocurrió un error')}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    maxWidth: 720,
    margin: '1rem auto',
    padding: '0 1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  card: {
    background: '#fff',
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  cardHeader: {
    padding: '1rem 1.25rem 0.5rem',
    borderBottom: '1px solid #f3f4f6',
  },
  cardTitle: { margin: 0, fontSize: '1.0625rem', fontWeight: 600, color: '#111' },
  cardDesc: { margin: '0.25rem 0 0.75rem', color: '#6b7280', fontSize: '0.875rem' },
  cardBody: { padding: '1rem 1.25rem 1.25rem' },
  field: { marginBottom: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' },
  label: { fontSize: '0.8125rem', fontWeight: 600, color: '#374151' },
  hint: { fontSize: '0.75rem', color: '#6b7280' },
  input: {
    padding: '0.5rem 0.625rem',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: '0.9375rem',
    fontFamily: 'inherit',
    color: '#111',
    background: '#fff',
  },
  btnPrimario: {
    marginTop: '0.5rem',
    padding: '0.5rem 1rem',
    border: 'none',
    borderRadius: 8,
    background: '#0ea5e9',
    color: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: '0.9375rem',
    alignSelf: 'flex-start',
  },
  btnPequeño: {
    padding: '0.375rem 0.625rem',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    background: '#fff',
    color: '#111',
    fontSize: '0.8125rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
  btnPequeñoDanger: { borderColor: '#fecaca', color: '#dc2626' },
  btnPequeñoGhost: { background: 'transparent', borderColor: 'transparent', color: '#6b7280' },
  btnIcono: {
    padding: 0,
    width: 28,
    height: 28,
    borderRadius: 6,
    border: '1px solid transparent',
    background: 'transparent',
    color: '#9ca3af',
    fontSize: '1.25rem',
    cursor: 'pointer',
  },
  btnGhostPequeño: {
    marginTop: '0.375rem',
    padding: '0.25rem 0',
    border: 'none',
    background: 'transparent',
    color: '#0ea5e9',
    fontWeight: 500,
    fontSize: '0.8125rem',
    cursor: 'pointer',
    textAlign: 'left',
  },
  lista: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  itemServicio: {
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'center',
    padding: '0.625rem 0.75rem',
    background: '#f9fafb',
    borderRadius: 8,
  },
  servicioNombre: {
    fontWeight: 600,
    color: '#111',
    fontSize: '0.9375rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap',
  },
  servicioMeta: { color: '#6b7280', fontSize: '0.8125rem', marginTop: '0.125rem' },
  badge: {
    fontSize: '0.65rem',
    fontWeight: 700,
    padding: '0.125rem 0.5rem',
    borderRadius: 999,
    background: '#dbeafe',
    color: '#1e40af',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  formNuevo: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
    marginTop: '0.75rem',
    paddingTop: '0.75rem',
    borderTop: '1px dashed #e5e7eb',
  },
  tabla: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    marginBottom: '0.5rem',
  },
  tdDia: {
    fontWeight: 600,
    fontSize: '0.9375rem',
    color: '#374151',
    padding: '0.5rem 0.75rem 0.5rem 0',
    verticalAlign: 'top' as const,
    width: 110,
  },
  filaFranja: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center',
    marginBottom: '0.375rem',
  },
  diaSinHorario: { color: '#9ca3af', fontStyle: 'italic', fontSize: '0.875rem' },
  emptyHint: { color: '#6b7280', fontSize: '0.875rem', textAlign: 'center' as const, padding: '0.75rem 0' },
  feedbackOk: {
    marginTop: '0.75rem',
    padding: '0.5rem 0.75rem',
    background: '#dcfce7',
    color: '#166534',
    borderRadius: 6,
    fontSize: '0.8125rem',
  },
  feedbackErr: {
    marginTop: '0.75rem',
    padding: '0.5rem 0.75rem',
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: 6,
    fontSize: '0.8125rem',
  },
}
