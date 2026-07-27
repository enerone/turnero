'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Turno {
  id: string
  servicio: { nombre: string; duracionMinutos: number }
  cliente: { nombre: string; telefono: string; email: string | null }
  inicio: string
  fin: string
}

interface Props {
  slug: string
  token: string
  turno: Turno
  timezone: string
  estadoInicial: 'pendiente' | 'confirmado'
}

function formatFecha(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: tz,
  })
}

function formatHora(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', timeZone: tz,
  })
}

type Estado = 'pendiente' | 'confirmado' | 'trabajando' | 'exito-confirmar' | 'exito-cancelar' | 'error'

export function ConfirmarToken({ slug, token, turno, timezone, estadoInicial }: Props) {
  const router = useRouter()
  const [estado, setEstado] = useState<Estado>(estadoInicial)
  const [error, setError] = useState<string | null>(null)

  const apiBase = `/${slug}/api/confirmar/${token}`

  const handleConfirmar = async () => {
    setEstado('trabajando')
    setError(null)
    try {
      const res = await fetch(apiBase, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al confirmar')
      setEstado('exito-confirmar')
      setTimeout(() => router.push(`/${slug}/reservar?confirmado=1`), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
      setEstado('error')
    }
  }

  const handleCancelar = async () => {
    setEstado('trabajando')
    setError(null)
    try {
      const res = await fetch(apiBase, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al cancelar')
      setEstado('exito-cancelar')
      setTimeout(() => router.push(`/${slug}/reservar?cancelado=1`), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
      setEstado('error')
    }
  }

  if (estado === 'exito-confirmar') {
    return (
      <div style={styles.success}>
        <div style={styles.check}>✓</div>
        <h2 style={styles.successTitle}>¡Turno confirmado!</h2>
        <p style={styles.successText}>Te esperamos. Si no podés venir, cancelá desde el mismo link.</p>
      </div>
    )
  }
  if (estado === 'exito-cancelar') {
    return (
      <div style={styles.success}>
        <div style={styles.check}>✓</div>
        <h2 style={styles.successTitle}>Turno cancelado</h2>
        <p style={styles.successText}>El horario quedó liberado para otra persona. Gracias por avisar.</p>
      </div>
    )
  }

  const yaConfirmado = estado === 'confirmado'

  return (
    <div style={styles.card}>
      <div style={styles.detail}>
        <span style={styles.label}>Servicio</span>
        <strong>{turno.servicio.nombre}</strong>
      </div>
      <div style={styles.detail}>
        <span style={styles.label}>Fecha</span>
        <strong>{formatFecha(turno.inicio, timezone)}</strong>
      </div>
      <div style={styles.detail}>
        <span style={styles.label}>Hora</span>
        <strong>{formatHora(turno.inicio, timezone)} – {formatHora(turno.fin, timezone)}</strong>
      </div>
      <div style={styles.detail}>
        <span style={styles.label}>Cliente</span>
        <strong>{turno.cliente.nombre}</strong>
      </div>
      {turno.cliente.telefono && (
        <div style={styles.detail}>
          <span style={styles.label}>WhatsApp</span>
          <strong>{turno.cliente.telefono}</strong>
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.actions}>
        <button
          type="button"
          onClick={handleCancelar}
          disabled={estado === 'trabajando'}
          style={{ ...styles.btn, ...styles.btnDanger, opacity: estado === 'trabajando' ? 0.6 : 1 }}
        >
          {estado === 'trabajando' ? 'Cancelando…' : (yaConfirmado ? 'Cancelar turno' : 'No voy a ir')}
        </button>
        {!yaConfirmado && (
          <button
            type="button"
            onClick={handleConfirmar}
            disabled={estado === 'trabajando'}
            style={{ ...styles.btn, ...styles.btnPrimary, opacity: estado === 'trabajando' ? 0.6 : 1 }}
          >
            {estado === 'trabajando' ? 'Confirmando…' : 'Confirmar mi turno'}
          </button>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    borderRadius: 8,
    padding: '1.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  detail: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.75rem 0',
    borderBottom: '1px solid #f0f0f0',
  },
  label: {
    color: '#666',
    fontSize: '0.875rem',
  },
  error: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#b91c1c',
    padding: '0.75rem',
    borderRadius: 4,
    marginTop: '1rem',
    fontSize: '0.875rem',
  },
  actions: {
    display: 'flex',
    gap: '0.75rem',
    marginTop: '1.5rem',
  },
  btn: {
    flex: 1,
    padding: '0.875rem',
    border: 'none',
    borderRadius: 4,
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnPrimary: {
    background: '#0ea5e9',
    color: '#fff',
  },
  btnDanger: {
    background: '#fee2e2',
    color: '#dc2626',
  },
  success: {
    textAlign: 'center',
    padding: '2rem 1rem',
  },
  check: {
    fontSize: '3rem',
    color: '#16a34a',
    marginBottom: '1rem',
  },
  successTitle: {
    fontSize: '1.5rem',
    color: '#16a34a',
    margin: '0 0 0.5rem',
  },
  successText: {
    color: '#666',
    margin: 0,
  },
}
