import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTenant } from '@/lib/tenant/resolve'
import { getSession } from '@/lib/auth/session'
import { SemanaGrid } from './SemanaGrid'
import { PanelMenu } from '../_components/PanelMenu'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ desde?: string }>
}

/** "YYYY-MM-DD" en el tz dado, a partir de un Date. */
function ymdEnTz(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const m: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') m[p.type] = p.value
  return `${m.year}-${m.month}-${m.day}`
}

/** Devuelve el instante UTC que corresponde a `hh:mm` del día `y-m-d` en `tz`. */
function zonedYmdHmToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
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

function lunesDeLaSemana(fechaLocal: string): string {
  const [y, m, d] = fechaLocal.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  // getUTCDay: 0=domingo. Queremos lunes como inicio → offset a lunes.
  const dow = dt.getUTCDay()
  const offset = dow === 0 ? -6 : 1 - dow
  dt.setUTCDate(dt.getUTCDate() + offset)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

function sumarDias(fechaLocal: string, dias: number): string {
  const [y, m, d] = fechaLocal.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + dias))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export default async function SemanaPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams])

  const s = await getSession()
  if (!s) redirect('/login')

  const { cuenta, db } = await getTenant()
  if (s.user.cuentaId !== cuenta.id) redirect('/login')

  const hoyLocal = ymdEnTz(new Date(), cuenta.timezone)
  const inicioSemanaLocal = sp.desde ?? lunesDeLaSemana(hoyLocal)
  const [y, m, d] = inicioSemanaLocal.split('-').map(Number)
  const inicioSemanaUtc = zonedYmdHmToUtc(y, m, d, 0, 0, cuenta.timezone)
  const finSemanaUtc = new Date(inicioSemanaUtc.getTime() + 7 * 24 * 60 * 60 * 1000)

  const [turnos, horariosSemanales, excepciones, eventosExternos] = await Promise.all([
    db.turno.findMany({
      where: {
        inicio: { gte: inicioSemanaUtc, lt: finSemanaUtc },
      },
      include: { cliente: true, servicio: true },
      orderBy: { inicio: 'asc' },
    }),
    db.horarioSemanal.findMany({ orderBy: { diaSemana: 'asc' } }),
    db.excepcionHorario.findMany({
      where: { fecha: { gte: inicioSemanaUtc, lt: finSemanaUtc } },
    }),
    db.eventoExterno.findMany({
      where: { inicio: { gte: inicioSemanaUtc, lt: finSemanaUtc } },
      select: { id: true, inicio: true, fin: true, titulo: true },
    }),
  ])

  const semanaAnterior = sumarDias(inicioSemanaLocal, -7)
  const semanaSiguiente = sumarDias(inicioSemanaLocal, 7)

  const dias = Array.from({ length: 7 }, (_, i) => {
    const fechaLocal = sumarDias(inicioSemanaLocal, i)
    const [dy, dm, dd] = fechaLocal.split('-').map(Number)
    return {
      fechaLocal,
      inicioUtc: zonedYmdHmToUtc(dy, dm, dd, 0, 0, cuenta.timezone).toISOString(),
      esHoy: fechaLocal === hoyLocal,
    }
  })

  const rangoHoras = calcularRangoHoras(horariosSemanales)

  return (
    <main style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <PanelMenu slug={cuenta.slug} activa="semana" />
          <span style={styles.cuentaNombre}>{cuenta.nombrePublico}</span>
        </div>
        <nav style={styles.nav}>
          <Link href={`/${cuenta.slug}/semana?desde=${semanaAnterior}`} style={styles.navBtn}>← Semana anterior</Link>
          <Link href={`/${cuenta.slug}/semana?desde=${lunesDeLaSemana(hoyLocal)}`} style={styles.hoyBtn}>Hoy</Link>
          <Link href={`/${cuenta.slug}/semana?desde=${semanaSiguiente}`} style={styles.navBtn}>Semana siguiente →</Link>
        </nav>
      </header>

      <SemanaGrid
        slug={cuenta.slug}
        timezone={cuenta.timezone}
        dias={dias}
        horaInicio={rangoHoras.inicio}
        horaFin={rangoHoras.fin}
        turnos={turnos.map((t) => ({
          id: t.id,
          inicio: t.inicio.toISOString(),
          fin: t.fin.toISOString(),
          estado: t.estado,
          servicio: t.servicio.nombre,
          duracionMinutos: t.servicio.duracionMinutos,
          cliente: t.cliente ? { nombre: t.cliente.nombre, telefono: t.cliente.telefono } : null,
        }))}
        eventosExternos={eventosExternos.map((e) => ({
          id: e.id,
          inicio: e.inicio.toISOString(),
          fin: e.fin.toISOString(),
          titulo: e.titulo,
        }))}
        excepcionesJson={JSON.stringify(excepciones.map((e) => ({
          fecha: e.fecha.toISOString(),
          tipo: e.tipo,
        })))}
      />
    </main>
  )
}

function calcularRangoHoras(horarios: Array<{ desde: Date; hasta: Date }>): { inicio: number; fin: number } {
  if (horarios.length === 0) return { inicio: 8, fin: 20 } // default L-V 8-20
  let inicio = 24
  let fin = 0
  for (const h of horarios) {
    const hi = h.desde.getUTCHours()
    const hf = h.hasta.getUTCHours() + (h.hasta.getUTCMinutes() > 0 ? 1 : 0)
    if (hi < inicio) inicio = hi
    if (hf > fin) fin = hf
  }
  return { inicio: Math.max(0, inicio - 1), fin: Math.min(24, fin + 1) }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: '#f4f5f7',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    padding: '0.75rem 1.5rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  viewLink: {
    color: '#0ea5e9',
    textDecoration: 'none',
    fontSize: '0.9375rem',
    fontWeight: 500,
  },
  cuentaNombre: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#111',
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  navBtn: {
    padding: '0.5rem 0.875rem',
    borderRadius: 8,
    background: '#f3f4f6',
    color: '#111',
    textDecoration: 'none',
    fontSize: '0.875rem',
    fontWeight: 500,
  },
  hoyBtn: {
    padding: '0.5rem 0.875rem',
    borderRadius: 8,
    background: '#0ea5e9',
    color: '#fff',
    textDecoration: 'none',
    fontSize: '0.875rem',
    fontWeight: 600,
  },
}
