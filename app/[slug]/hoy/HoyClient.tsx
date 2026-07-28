'use client'

import { useState, useTransition } from 'react'
import { cambiarEstadoTurno } from './actions'
import { normalizarTelefonoE164 } from '@/lib/format/telefono'

type Estado = 'borrador' | 'confirmado' | 'cancelado' | 'completado' | 'no_asistio'
type Rol = 'owner' | 'secretaria'

interface Turno {
  id: string
  inicio: string
  fin: string
  estado: Estado
  servicio: string
  cliente: { nombre: string; telefono: string; email: string | null } | null
  notas: string
}

interface Props {
  slug: string
  timezone: string
  proximoId: string | null
  rol: Rol
  turnos: Turno[]
  horaAhora: string
}

function formatHora(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
  })
}

function telHref(telefono: string): string {
  const e164 = normalizarTelefonoE164(telefono)
  return e164 ? `tel:${e164}` : '#'
}

function waHref(telefono: string): string {
  const e164 = normalizarTelefonoE164(telefono)
  return e164 ? `https://wa.me/${e164.slice(1)}` : '#'
}

const ESTADO_CHIP: Record<Estado, { label: string; bg: string; color: string }> = {
  borrador: { label: 'Sin confirmar', bg: '#fef3c7', color: '#92400e' },
  confirmado: { label: 'Confirmado', bg: '#dbeafe', color: '#1e40af' },
  cancelado: { label: 'Cancelado', bg: '#fee2e2', color: '#991b1b' },
  completado: { label: 'Completado', bg: '#dcfce7', color: '#166534' },
  no_asistio: { label: 'No vino', bg: '#fce7f3', color: '#9f1239' },
}

export function HoyClient({ slug: _slug, timezone, proximoId, rol: _rol, turnos, horaAhora }: Props) {
  const [pending, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ahora = new Date(horaAhora).getTime()

  const doAccion = (turnoId: string, nuevoEstado: Estado) => {
    setError(null)
    setPendingId(turnoId)
    startTransition(async () => {
      const res = await cambiarEstadoTurno({ turnoId, nuevoEstado })
      if (!res.ok) setError(res.error ?? 'No se pudo actualizar')
      setPendingId(null)
    })
  }

  const proximo = turnos.find((t) => t.id === proximoId) ?? null

  return (
    <div style={styles.wrapper}>
      {error && <div style={styles.errorBanner}>{error}</div>}

      {proximo && (
        <section style={styles.proximoCard}>
          <div style={styles.proximoLabel}>Próximo turno</div>
          <div style={styles.proximoHora}>{formatHora(proximo.inicio, timezone)} – {formatHora(proximo.fin, timezone)}</div>
          <div style={styles.proximoCliente}>{proximo.cliente?.nombre ?? 'Sin cliente'}</div>
          <div style={styles.proximoServicio}>{proximo.servicio}</div>
          <div style={styles.proximoAcciones}>
            {proximo.cliente?.telefono && (
              <>
                <a href={telHref(proximo.cliente.telefono)} style={styles.btnCall}>📞 Llamar</a>
                <a href={waHref(proximo.cliente.telefono)} style={styles.btnWa} target="_blank" rel="noreferrer">💬 WhatsApp</a>
              </>
            )}
          </div>
        </section>
      )}

      <ol style={styles.lista}>
        {turnos.map((t) => {
          const chip = ESTADO_CHIP[t.estado]
          const inicioMs = new Date(t.inicio).getTime()
          const finMs = new Date(t.fin).getTime()
          const enCurso = inicioMs <= ahora && ahora < finMs
          const yaPaso = finMs < ahora
          const cancelado = t.estado === 'cancelado'
          const busy = pending && pendingId === t.id

          return (
            <li
              key={t.id}
              style={{
                ...styles.turnoCard,
                ...(enCurso ? styles.turnoEnCurso : {}),
                ...(cancelado ? styles.turnoCancelado : {}),
                ...(t.id === proximoId ? styles.turnoProximoRow : {}),
              }}
            >
              <div style={styles.turnoHeader}>
                <div style={styles.turnoHora}>{formatHora(t.inicio, timezone)}</div>
                <span style={{ ...styles.chip, background: chip.bg, color: chip.color }}>{chip.label}</span>
              </div>
              <div style={styles.turnoBody}>
                <div style={styles.turnoCliente}>{t.cliente?.nombre ?? '(sin cliente)'}</div>
                <div style={styles.turnoServicio}>{t.servicio}</div>
                {t.notas && <div style={styles.turnoNotas}>{t.notas}</div>}
              </div>
              <div style={styles.turnoAcciones}>
                {t.cliente?.telefono && (
                  <>
                    <a href={telHref(t.cliente.telefono)} style={styles.iconBtn} aria-label="Llamar">📞</a>
                    <a href={waHref(t.cliente.telefono)} style={styles.iconBtn} target="_blank" rel="noreferrer" aria-label="WhatsApp">💬</a>
                  </>
                )}
                {!cancelado && !yaPaso && t.estado !== 'confirmado' && (
                  <button style={styles.actionBtn} disabled={busy} onClick={() => doAccion(t.id, 'confirmado')}>
                    Confirmar
                  </button>
                )}
                {!cancelado && yaPaso && t.estado === 'confirmado' && (
                  <>
                    <button style={styles.actionBtn} disabled={busy} onClick={() => doAccion(t.id, 'completado')}>
                      ✓ Vino
                    </button>
                    <button style={{ ...styles.actionBtn, ...styles.actionBtnDanger }} disabled={busy} onClick={() => doAccion(t.id, 'no_asistio')}>
                      ✗ No vino
                    </button>
                  </>
                )}
                {!cancelado && !yaPaso && (
                  <button style={{ ...styles.actionBtn, ...styles.actionBtnDanger }} disabled={busy} onClick={() => doAccion(t.id, 'cancelado')}>
                    Cancelar
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { padding: '1rem' },
  errorBanner: {
    background: '#fee2e2',
    border: '1px solid #fecaca',
    color: '#991b1b',
    padding: '0.75rem',
    borderRadius: 8,
    marginBottom: '1rem',
    fontSize: '0.875rem',
  },
  proximoCard: {
    background: '#0ea5e9',
    color: '#fff',
    padding: '1.25rem',
    borderRadius: 12,
    marginBottom: '1rem',
    boxShadow: '0 4px 12px rgba(14, 165, 233, 0.25)',
  },
  proximoLabel: {
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    opacity: 0.85,
    marginBottom: '0.25rem',
  },
  proximoHora: {
    fontSize: '1.75rem',
    fontWeight: 700,
    lineHeight: 1.1,
  },
  proximoCliente: {
    fontSize: '1.125rem',
    fontWeight: 600,
    marginTop: '0.5rem',
  },
  proximoServicio: {
    fontSize: '0.9375rem',
    opacity: 0.9,
  },
  proximoAcciones: {
    display: 'flex',
    gap: '0.5rem',
    marginTop: '1rem',
  },
  btnCall: {
    flex: 1,
    background: 'rgba(255,255,255,0.2)',
    color: '#fff',
    textDecoration: 'none',
    padding: '0.75rem',
    borderRadius: 8,
    textAlign: 'center',
    fontWeight: 600,
    fontSize: '0.9375rem',
  },
  btnWa: {
    flex: 1,
    background: '#25d366',
    color: '#fff',
    textDecoration: 'none',
    padding: '0.75rem',
    borderRadius: 8,
    textAlign: 'center',
    fontWeight: 600,
    fontSize: '0.9375rem',
  },
  lista: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  turnoCard: {
    background: '#fff',
    borderRadius: 8,
    padding: '0.875rem 1rem',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  },
  turnoProximoRow: {
    borderLeft: '3px solid #0ea5e9',
  },
  turnoEnCurso: {
    background: '#f0f9ff',
  },
  turnoCancelado: {
    opacity: 0.55,
  },
  turnoHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.375rem',
  },
  turnoHora: {
    fontSize: '1.125rem',
    fontWeight: 700,
    color: '#111',
  },
  chip: {
    fontSize: '0.7rem',
    fontWeight: 600,
    padding: '0.125rem 0.5rem',
    borderRadius: 999,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  turnoBody: {
    marginBottom: '0.5rem',
  },
  turnoCliente: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#111',
  },
  turnoServicio: {
    fontSize: '0.875rem',
    color: '#6b7280',
  },
  turnoNotas: {
    fontSize: '0.8125rem',
    color: '#6b7280',
    fontStyle: 'italic',
    marginTop: '0.25rem',
  },
  turnoAcciones: {
    display: 'flex',
    gap: '0.375rem',
    flexWrap: 'wrap',
  },
  iconBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: 8,
    background: '#f3f4f6',
    color: '#111',
    textDecoration: 'none',
    fontSize: '1.125rem',
  },
  actionBtn: {
    padding: '0.5rem 0.875rem',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#111',
    fontSize: '0.8125rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  actionBtnDanger: {
    color: '#dc2626',
    borderColor: '#fecaca',
  },
}
