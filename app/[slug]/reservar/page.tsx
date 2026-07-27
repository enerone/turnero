import { notFound } from 'next/navigation'
import { getTenant } from '@/lib/tenant/resolve'
import { ReservaPublica } from './ReservaPublica'

export const revalidate = 60

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { cuenta } = await getTenant()
  return {
    title: `Reservar turno - ${cuenta.nombrePublico}`,
    description: `Agendá tu turno en ${cuenta.nombrePublico}. Rápido, sin login.`,
    openGraph: {
      title: `Reservar turno - ${cuenta.nombrePublico}`,
      description: `Agendá tu turno en ${cuenta.nombrePublico}.`,
    },
  }
}

export default async function ReservaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { cuenta, db } = await getTenant()

  if (cuenta.slug !== slug) notFound()

  const servicios = await db.servicio.findMany({
    where: { activo: true },
    orderBy: { esDefault: 'desc' },
    select: { id: true, nombre: true, duracionMinutos: true, esDefault: true },
  })

  if (servicios.length === 0) {
    return (
      <main style={styles.container}>
        <h1 style={styles.title}>{cuenta.nombrePublico}</h1>
        <p style={styles.empty}>No hay servicios disponibles para reservar.</p>
      </main>
    )
  }

  return (
    <main style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>{cuenta.nombrePublico}</h1>
        {cuenta.ubicacion && <p style={styles.location}>{cuenta.ubicacion}</p>}
      </header>
      <ReservaPublica cuenta={cuenta} servicios={servicios} />
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 480,
    margin: '0 auto',
    padding: '1rem',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    minHeight: '100vh',
    background: '#fafafa',
  },
  header: {
    textAlign: 'center',
    padding: '1.5rem 0 1rem',
    background: '#fff',
    borderBottom: '1px solid #eee',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 600,
    color: '#111',
    margin: 0,
  },
  location: {
    fontSize: '0.875rem',
    color: '#666',
    margin: '0.25rem 0 0',
  },
  empty: {
    textAlign: 'center',
    color: '#666',
    padding: '2rem',
  },
}