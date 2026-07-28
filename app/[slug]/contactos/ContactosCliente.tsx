'use client'

import { useState, useTransition, useMemo } from 'react'
import { crearCliente, actualizarCliente, borrarCliente } from './actions'

interface Cliente {
  id: string
  nombre: string
  telefono: string
  email: string | null
  notas: string
  totalTurnos: number
  createdAt: string
}

interface Props {
  slug: string
  clientes: Cliente[]
}

export function ContactosCliente({ clientes: inicial }: Props) {
  const [clientes, setClientes] = useState(inicial)
  const [busqueda, setBusqueda] = useState('')
  const [creando, setCreando] = useState(false)
  const [seleccionado, setSeleccionado] = useState<Cliente | null>(null)

  const filtrados = useMemo(() => {
    const q = busqueda.toLowerCase().trim()
    if (!q) return clientes
    return clientes.filter(
      (c) =>
        c.nombre.toLowerCase().includes(q) ||
        c.telefono.includes(q) ||
        (c.email?.toLowerCase().includes(q) ?? false),
    )
  }, [busqueda, clientes])

  function onCreado(nuevo: Cliente) {
    setClientes((prev) => [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)))
  }

  function onActualizado(actualizado: Cliente) {
    setClientes((prev) => prev.map((c) => (c.id === actualizado.id ? actualizado : c)))
    setSeleccionado(null)
  }

  function onBorrado(id: string) {
    setClientes((prev) => prev.filter((c) => c.id !== id))
    setSeleccionado(null)
  }

  return (
    <>
      <div style={styles.toolbar}>
        <input
          type="search"
          placeholder="Buscar por nombre, teléfono o email…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          style={styles.search}
        />
        <button onClick={() => setCreando(true)} style={styles.btnNuevo}>
          + Nuevo
        </button>
      </div>

      {clientes.length === 0 ? (
        <div style={styles.empty}>
          <p>Todavía no hay contactos.</p>
          <p style={styles.emptyHint}>Se crean automáticamente al reservar, o podés agregar uno manualmente.</p>
        </div>
      ) : filtrados.length === 0 ? (
        <div style={styles.empty}>
          <p>Sin resultados para "{busqueda}".</p>
        </div>
      ) : (
        <ul style={styles.list}>
          {filtrados.map((c) => (
            <li key={c.id} style={styles.card} onClick={() => setSeleccionado(c)}>
              <div style={styles.cardMain}>
                <span style={styles.nombre}>{c.nombre}</span>
                <span style={styles.turnos}>{c.totalTurnos} {c.totalTurnos === 1 ? 'turno' : 'turnos'}</span>
              </div>
              <div style={styles.cardSub}>
                <a
                  href={`https://wa.me/${c.telefono.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={styles.tel}
                >
                  {c.telefono}
                </a>
                {c.email && <span style={styles.email}>{c.email}</span>}
              </div>
              {c.notas && <p style={styles.notas}>{c.notas}</p>}
            </li>
          ))}
        </ul>
      )}

      {creando && (
        <DrawerCrear
          onClose={() => setCreando(false)}
          onCreado={(c) => { onCreado(c); setCreando(false) }}
        />
      )}

      {seleccionado && (
        <DrawerEditar
          cliente={seleccionado}
          onClose={() => setSeleccionado(null)}
          onActualizado={onActualizado}
          onBorrado={onBorrado}
        />
      )}
    </>
  )
}

// ─── DRAWER CREAR ─────────────────────────────────────────────

function DrawerCrear({ onClose, onCreado }: { onClose: () => void; onCreado: (c: Cliente) => void }) {
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [notas, setNotas] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function guardar() {
    setError('')
    startTransition(async () => {
      const res = await crearCliente({ nombre, telefono, email, notas })
      if (!res.ok) { setError(res.error ?? 'Error'); return }
      onCreado({
        id: crypto.randomUUID(), // placeholder — la página se revalida
        nombre: nombre.trim(),
        telefono,
        email: email.trim() || null,
        notas: notas.trim(),
        totalTurnos: 0,
        createdAt: new Date().toISOString(),
      })
    })
  }

  return (
    <>
      <div onClick={onClose} style={styles.overlay} />
      <div style={styles.drawer}>
        <div style={styles.drawerHeader}>
          <span style={styles.drawerTitle}>Nuevo contacto</span>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.drawerBody}>
          <label style={styles.label}>
            Nombre *
            <input style={styles.input} value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
          </label>
          <label style={styles.label}>
            Teléfono *
            <input
              style={styles.input}
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="+54 9 11 1234 5678"
            />
            <span style={styles.hint}>Con código de país. Se normaliza a E.164.</span>
          </label>
          <label style={styles.label}>
            Email
            <input style={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="opcional" />
          </label>
          <label style={styles.label}>
            Notas internas
            <textarea style={styles.textarea} value={notas} onChange={(e) => setNotas(e.target.value)} rows={3} placeholder="Visible solo para vos" />
          </label>
          {error && <p style={styles.errorMsg}>{error}</p>}
        </div>

        <div style={styles.drawerFooter}>
          <button onClick={onClose} style={styles.btnSecundario} disabled={isPending}>Cancelar</button>
          <button onClick={guardar} style={styles.btnPrimario} disabled={isPending || !nombre.trim() || !telefono.trim()}>
            {isPending ? 'Guardando…' : 'Crear contacto'}
          </button>
        </div>
      </div>
    </>
  )
}

// ─── DRAWER EDITAR ────────────────────────────────────────────

function DrawerEditar({
  cliente,
  onClose,
  onActualizado,
  onBorrado,
}: {
  cliente: Cliente
  onClose: () => void
  onActualizado: (c: Cliente) => void
  onBorrado: (id: string) => void
}) {
  const [nombre, setNombre] = useState(cliente.nombre)
  const [email, setEmail] = useState(cliente.email ?? '')
  const [notas, setNotas] = useState(cliente.notas)
  const [confirmandoBorrar, setConfirmandoBorrar] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function guardar() {
    setError('')
    startTransition(async () => {
      const res = await actualizarCliente({ id: cliente.id, nombre, email, notas })
      if (!res.ok) { setError(res.error ?? 'Error'); return }
      onActualizado({ ...cliente, nombre, email: email || null, notas })
    })
  }

  function eliminar() {
    startTransition(async () => {
      const res = await borrarCliente({ id: cliente.id })
      if (!res.ok) { setError(res.error ?? 'Error'); return }
      onBorrado(cliente.id)
    })
  }

  return (
    <>
      <div onClick={onClose} style={styles.overlay} />
      <div style={styles.drawer}>
        <div style={styles.drawerHeader}>
          <span style={styles.drawerTitle}>Editar contacto</span>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.drawerBody}>
          <label style={styles.label}>
            Nombre
            <input style={styles.input} value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </label>
          <label style={styles.label}>
            Teléfono
            <input style={{ ...styles.input, background: '#f3f4f6', color: '#6b7280' }} value={cliente.telefono} readOnly />
            <span style={styles.hint}>El teléfono no se puede cambiar (es el identificador único).</span>
          </label>
          <label style={styles.label}>
            Email
            <input style={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="opcional" />
          </label>
          <label style={styles.label}>
            Notas internas
            <textarea style={styles.textarea} value={notas} onChange={(e) => setNotas(e.target.value)} rows={4} placeholder="Visible solo para vos" />
          </label>
          {error && <p style={styles.errorMsg}>{error}</p>}

          <div style={styles.separador} />

          {!confirmandoBorrar ? (
            <button
              onClick={() => setConfirmandoBorrar(true)}
              style={styles.btnEliminar}
              disabled={isPending}
            >
              Eliminar contacto
            </button>
          ) : (
            <div style={styles.confirmBox}>
              <p style={styles.confirmTexto}>
                {cliente.totalTurnos > 0
                  ? `¿Eliminar a ${cliente.nombre}? Sus ${cliente.totalTurnos} turno${cliente.totalTurnos !== 1 ? 's' : ''} quedan en el historial sin contacto vinculado.`
                  : `¿Eliminar a ${cliente.nombre}? Esta acción no se puede deshacer.`}
              </p>
              <div style={styles.confirmBtns}>
                <button onClick={() => setConfirmandoBorrar(false)} style={styles.btnSecundario} disabled={isPending}>
                  Cancelar
                </button>
                <button onClick={eliminar} style={styles.btnDanger} disabled={isPending}>
                  {isPending ? 'Eliminando…' : 'Sí, eliminar'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={styles.drawerFooter}>
          <button onClick={onClose} style={styles.btnSecundario} disabled={isPending}>Cancelar</button>
          <button onClick={guardar} style={styles.btnPrimario} disabled={isPending}>
            {isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    padding: '1rem 1.5rem 0.5rem',
    display: 'flex',
    gap: '0.75rem',
  },
  search: {
    flex: 1,
    padding: '0.625rem 0.875rem',
    borderRadius: 8,
    border: '1px solid #e5e7eb',
    fontSize: '0.9375rem',
    background: '#fff',
    outline: 'none',
  },
  btnNuevo: {
    padding: '0.625rem 1.125rem',
    borderRadius: 8,
    border: 'none',
    background: '#0ea5e9',
    color: '#fff',
    fontSize: '0.9375rem',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: '0.5rem 1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  card: {
    background: '#fff',
    borderRadius: 10,
    padding: '0.875rem 1rem',
    cursor: 'pointer',
    border: '1px solid #e5e7eb',
  },
  cardMain: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: '0.5rem',
  },
  nombre: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#111',
  },
  turnos: {
    fontSize: '0.8125rem',
    color: '#9ca3af',
    flexShrink: 0,
  },
  cardSub: {
    display: 'flex',
    gap: '1rem',
    flexWrap: 'wrap',
    marginTop: '0.25rem',
  },
  tel: {
    fontSize: '0.875rem',
    color: '#0ea5e9',
    textDecoration: 'none',
  },
  email: {
    fontSize: '0.875rem',
    color: '#6b7280',
  },
  notas: {
    margin: '0.375rem 0 0',
    fontSize: '0.8125rem',
    color: '#9ca3af',
    whiteSpace: 'pre-wrap',
  },
  empty: {
    textAlign: 'center',
    color: '#6b7280',
    padding: '4rem 1rem',
  },
  emptyHint: {
    fontSize: '0.875rem',
    marginTop: '0.5rem',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.35)',
    zIndex: 50,
  },
  drawer: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: 340,
    background: '#fff',
    boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
    zIndex: 51,
    display: 'flex',
    flexDirection: 'column',
  },
  drawerHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem 1.5rem',
    borderBottom: '1px solid #e5e7eb',
  },
  drawerTitle: {
    fontWeight: 600,
    fontSize: '1rem',
    color: '#111',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '1.125rem',
    color: '#6b7280',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 6,
  },
  drawerBody: {
    flex: 1,
    overflowY: 'auto',
    padding: '1.25rem 1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: '#374151',
  },
  input: {
    padding: '0.5rem 0.75rem',
    borderRadius: 8,
    border: '1px solid #e5e7eb',
    fontSize: '0.9375rem',
    outline: 'none',
  },
  textarea: {
    padding: '0.5rem 0.75rem',
    borderRadius: 8,
    border: '1px solid #e5e7eb',
    fontSize: '0.9375rem',
    resize: 'vertical',
    outline: 'none',
    fontFamily: 'inherit',
  },
  hint: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    fontWeight: 400,
  },
  errorMsg: {
    color: '#dc2626',
    fontSize: '0.875rem',
    margin: 0,
  },
  separador: {
    borderTop: '1px solid #f3f4f6',
    margin: '0.5rem 0',
  },
  btnEliminar: {
    background: 'none',
    border: '1px solid #fca5a5',
    color: '#dc2626',
    borderRadius: 8,
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
    width: '100%',
  },
  confirmBox: {
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: 8,
    padding: '0.875rem',
  },
  confirmTexto: {
    margin: '0 0 0.75rem',
    fontSize: '0.875rem',
    color: '#7f1d1d',
    lineHeight: 1.5,
  },
  confirmBtns: {
    display: 'flex',
    gap: '0.5rem',
    justifyContent: 'flex-end',
  },
  drawerFooter: {
    padding: '1rem 1.5rem',
    borderTop: '1px solid #e5e7eb',
    display: 'flex',
    gap: '0.75rem',
    justifyContent: 'flex-end',
  },
  btnSecundario: {
    padding: '0.5rem 1rem',
    borderRadius: 8,
    border: '1px solid #e5e7eb',
    background: '#fff',
    color: '#374151',
    fontSize: '0.9375rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
  btnPrimario: {
    padding: '0.5rem 1.25rem',
    borderRadius: 8,
    border: 'none',
    background: '#0ea5e9',
    color: '#fff',
    fontSize: '0.9375rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnDanger: {
    padding: '0.5rem 1rem',
    borderRadius: 8,
    border: 'none',
    background: '#dc2626',
    color: '#fff',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
}
