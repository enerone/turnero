import { redirect } from 'next/navigation'
import { getTenant } from '@/lib/tenant/resolve'
import { getSession } from '@/lib/auth/session'
import { PanelMenu } from '../_components/PanelMenu'
import { ContactosCliente } from './ContactosCliente'

export const dynamic = 'force-dynamic'

export default async function ContactosPage() {
  const s = await getSession()
  if (!s) redirect('/login')

  const { cuenta, db } = await getTenant()
  if (s.user.cuentaId !== cuenta.id) redirect('/login')

  const clientes = await db.cliente.findMany({
    orderBy: { nombre: 'asc' },
    include: {
      _count: { select: { turnos: true } },
    },
  })

  return (
    <main style={styles.container}>
      <header style={styles.header}>
        <PanelMenu slug={cuenta.slug} activa="contactos" />
        <h1 style={styles.h1}>Contactos</h1>
        <span style={styles.total}>{clientes.length} {clientes.length === 1 ? 'contacto' : 'contactos'}</span>
      </header>

      <ContactosCliente
        slug={cuenta.slug}
        clientes={clientes.map((c) => ({
          id: c.id,
          nombre: c.nombre,
          telefono: c.telefono,
          email: c.email,
          notas: c.notas,
          totalTurnos: c._count.turnos,
          createdAt: c.createdAt.toISOString(),
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
    padding: '0 0 2rem',
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
    flex: 1,
  },
  total: {
    fontSize: '0.875rem',
    color: '#6b7280',
  },
}
