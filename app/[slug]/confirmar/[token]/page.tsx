import { notFound } from 'next/navigation'
import { createHash } from 'node:crypto'
import { getTenant } from '@/lib/tenant/resolve'
import { ConfirmarToken } from './ConfirmarToken'

export const dynamic = 'force-dynamic'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export default async function ConfirmarPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { token } = await params
  const { cuenta, db } = await getTenant()
  const tokenHash = hashToken(token)

  const tokenRow = await db.tokenConfirmacion.findFirst({
    where: { tokenHash },
    include: { turno: { include: { servicio: true, cliente: true } } },
  })

  if (!tokenRow || !tokenRow.turno) notFound()

  const turno = tokenRow.turno
  const expira = tokenRow.expiraEn
  const yaExpirado = turno.estado === 'borrador' && expira < new Date()

  if (yaExpirado) {
    await db.turno.update({
      where: { id: turno.id },
      data: { estado: 'cancelado', origenCancelacion: 'cliente' },
    })
    notFound()
  }

  return (
    <main style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>{cuenta.nombrePublico}</h1>
      </header>
      <ConfirmarToken
        slug={cuenta.slug}
        token={token}
        estadoInicial={turno.estado === 'confirmado' ? 'confirmado' : 'pendiente'}
        turno={{
          id: turno.id,
          servicio: { nombre: turno.servicio.nombre, duracionMinutos: turno.servicio.duracionMinutos },
          cliente: {
            nombre: turno.cliente?.nombre ?? '',
            telefono: turno.cliente?.telefono ?? '',
            email: turno.cliente?.email ?? null,
          },
          inicio: turno.inicio.toISOString(),
          fin: turno.fin.toISOString(),
        }}
        timezone={cuenta.timezone}
      />
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
}
