import { redirect } from 'next/navigation'
import { getTenant } from '@/lib/tenant/resolve'
import { getSession } from '@/lib/auth/session'
import { puede } from '@/lib/auth/puede'
import { ConfigCliente } from './ConfigCliente'
import { PanelMenu } from '../_components/PanelMenu'

export const dynamic = 'force-dynamic'

function timeToHhmm(t: Date): string {
  const h = String(t.getUTCHours()).padStart(2, '0')
  const m = String(t.getUTCMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

export default async function ConfigPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: _slug } = await params

  const s = await getSession()
  if (!s) redirect('/login')

  const { cuenta, db } = await getTenant()
  if (s.user.cuentaId !== cuenta.id) redirect('/login')

  const puedeEditar = puede({ rol: s.user.rol, cuentaId: s.user.cuentaId }, 'editar_config')

  const [servicios, horarios, excepciones] = await Promise.all([
    db.servicio.findMany({ orderBy: [{ activo: 'desc' }, { esDefault: 'desc' }, { nombre: 'asc' }] }),
    db.horarioSemanal.findMany({ orderBy: [{ diaSemana: 'asc' }, { desde: 'asc' }] }),
    db.excepcionHorario.findMany({ where: { fecha: { gte: new Date() } }, orderBy: { fecha: 'asc' } }),
  ])

  return (
    <main style={styles.container}>
      <header style={styles.header}>
        <PanelMenu slug={cuenta.slug} activa="config" />
        <h1 style={styles.h1}>Configuración</h1>
      </header>

      {!puedeEditar && (
        <div style={styles.readOnlyBanner}>
          Sólo el dueño de la cuenta puede editar esta configuración. Estás en modo lectura.
        </div>
      )}

      <ConfigCliente
        slug={cuenta.slug}
        puedeEditar={puedeEditar}
        cuenta={{
          nombrePublico: cuenta.nombrePublico,
          telefonoWhatsapp: cuenta.telefonoWhatsapp,
          color: cuenta.color,
          ubicacion: cuenta.ubicacion,
          timezone: cuenta.timezone,
        }}
        servicios={servicios.map((s) => ({
          id: s.id,
          nombre: s.nombre,
          duracionMinutos: s.duracionMinutos,
          esDefault: s.esDefault,
          permiteSobreturnos: s.permiteSobreturnos,
          activo: s.activo,
        }))}
        franjas={horarios.map((h) => ({
          diaSemana: h.diaSemana,
          desde: timeToHhmm(h.desde),
          hasta: timeToHhmm(h.hasta),
        }))}
        excepciones={excepciones.map((e) => ({
          id: e.id,
          fecha: e.fecha.toISOString().slice(0, 10),
          tipo: e.tipo,
          desde: e.desde ? timeToHhmm(e.desde) : null,
          hasta: e.hasta ? timeToHhmm(e.hasta) : null,
          motivo: e.motivo,
        }))}
      />
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: '#f4f5f7',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '0 0 3rem',
  },
  header: {
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    padding: '0.75rem 1.5rem',
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  h1: {
    margin: 0,
    fontSize: '1.25rem',
    fontWeight: 600,
    color: '#111',
  },
  readOnlyBanner: {
    background: '#fef3c7',
    border: '1px solid #f59e0b',
    color: '#92400e',
    padding: '0.75rem 1rem',
    margin: '1rem 1.5rem 0',
    borderRadius: 8,
    fontSize: '0.875rem',
  },
}
