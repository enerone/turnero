import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTenant } from '@/lib/tenant/resolve'
import { getSession } from '@/lib/auth/session'
import { formatearFechaLocal } from '@/lib/format/fecha'
import { HoyClient } from './HoyClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ fecha?: string }>
}

function inicioDelDiaEnTz(fechaLocal: string, tz: string): Date {
  // fechaLocal como "YYYY-MM-DD" (día calendario del tenant).
  // Devolvemos el instante UTC que corresponde a 00:00 del día en el tz.
  const [y, m, d] = fechaLocal.split('-').map(Number)
  // Iterativo: partimos de UTC medianoche y ajustamos por offset del tz.
  const guess = Date.UTC(y, m - 1, d)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(guess))
  const map: Record<string, number> = {}
  for (const p of parts) if (p.type !== 'literal') map[p.type] = Number(p.value)
  if (map.hour === 24) map.hour = 0
  const diffMin = (map.year - y) * 525600 + (map.month - m) * 43800 + (map.day - d) * 1440 + map.hour * 60 + map.minute
  return new Date(guess - diffMin * 60_000)
}

function fechaLocalHoy(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const m: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') m[p.type] = p.value
  return `${m.year}-${m.month}-${m.day}`
}

function sumarDias(fechaLocal: string, dias: number): string {
  const [y, m, d] = fechaLocal.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + dias))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export default async function HoyPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams])

  const s = await getSession()
  if (!s) redirect('/login')

  const { cuenta, db } = await getTenant()
  if (s.user.cuentaId !== cuenta.id) redirect('/login')

  const fechaLocal = sp.fecha ?? fechaLocalHoy(cuenta.timezone)
  const inicioDia = inicioDelDiaEnTz(fechaLocal, cuenta.timezone)
  const finDia = new Date(inicioDia.getTime() + 24 * 60 * 60 * 1000)

  const turnos = await db.turno.findMany({
    where: {
      inicio: { gte: inicioDia, lt: finDia },
      estado: { notIn: [] }, // todos, incluidos cancelados (los mostramos con estilo tachado)
    },
    include: { cliente: true, servicio: true },
    orderBy: { inicio: 'asc' },
  })

  const ahora = new Date()
  const proximoIdx = turnos.findIndex((t) => t.inicio >= ahora && t.estado !== 'cancelado')
  const proximo = proximoIdx >= 0 ? turnos[proximoIdx] : null

  const esHoy = fechaLocal === fechaLocalHoy(cuenta.timezone)
  const fechaLabel = formatearFechaLocal(inicioDia, cuenta.timezone)
  const ayer = sumarDias(fechaLocal, -1)
  const manana = sumarDias(fechaLocal, 1)

  return (
    <main style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerRow}>
          <Link href={`/${cuenta.slug}/hoy?fecha=${ayer}`} style={styles.navBtn} aria-label="Día anterior">←</Link>
          <div style={styles.headerCenter}>
            <div style={styles.cuentaNombre}>{cuenta.nombrePublico}</div>
            <div style={styles.fecha}>{esHoy ? 'Hoy' : ''} {fechaLabel}</div>
          </div>
          <Link href={`/${cuenta.slug}/hoy?fecha=${manana}`} style={styles.navBtn} aria-label="Día siguiente">→</Link>
        </div>
      </header>

      {turnos.length === 0 ? (
        <div style={styles.empty}>
          <p>No hay turnos {esHoy ? 'para hoy' : 'este día'}.</p>
        </div>
      ) : (
        <HoyClient
          slug={cuenta.slug}
          timezone={cuenta.timezone}
          proximoId={proximo?.id ?? null}
          rol={s.user.rol}
          turnos={turnos.map((t) => ({
            id: t.id,
            inicio: t.inicio.toISOString(),
            fin: t.fin.toISOString(),
            estado: t.estado,
            servicio: t.servicio.nombre,
            cliente: t.cliente
              ? { nombre: t.cliente.nombre, telefono: t.cliente.telefono, email: t.cliente.email }
              : null,
            notas: t.notas,
          }))}
          horaAhora={ahora.toISOString()}
        />
      )}

      <nav style={styles.footerNav}>
        <Link href={`/${cuenta.slug}/hoy`} style={styles.footerLink}>Hoy</Link>
        <Link href={`/${cuenta.slug}/semana`} style={styles.footerLink}>Semana</Link>
      </nav>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 560,
    margin: '0 auto',
    padding: '0 0 5rem',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    minHeight: '100vh',
    background: '#f4f5f7',
  },
  header: {
    position: 'sticky',
    top: 0,
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    padding: '0.75rem 1rem',
    zIndex: 10,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  headerCenter: {
    flex: 1,
    textAlign: 'center',
  },
  cuentaNombre: {
    fontSize: '0.75rem',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  fecha: {
    fontSize: '1.125rem',
    fontWeight: 600,
    color: '#111',
    textTransform: 'capitalize',
  },
  navBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    borderRadius: 8,
    background: '#f3f4f6',
    color: '#111',
    textDecoration: 'none',
    fontSize: '1.25rem',
    fontWeight: 600,
  },
  empty: {
    textAlign: 'center',
    color: '#6b7280',
    padding: '4rem 1rem',
  },
  footerNav: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'space-around',
    background: '#fff',
    borderTop: '1px solid #e5e7eb',
    padding: '0.75rem 0',
  },
  footerLink: {
    color: '#0ea5e9',
    textDecoration: 'none',
    fontSize: '0.9375rem',
    fontWeight: 500,
  },
}
