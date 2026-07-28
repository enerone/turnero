import { redirect } from 'next/navigation'
import { getTenant } from '@/lib/tenant/resolve'
import { getSession } from '@/lib/auth/session'

export default async function PanelHomePage() {
  const s = await getSession()
  if (!s) redirect('/login')

  const { cuenta, db } = await getTenant()
  if (s.user.cuentaId !== cuenta.id) redirect('/login')

  const integracion = await db.integracionCalendar.findUnique({
    where: { cuentaId: cuenta.id },
  })
  const calendarListo = !!integracion?.calendarIdDedicado

  // Panel operativo por default: la lista mobile del día.
  // (La grilla desktop /semana llega en el próximo sub-lote.)
  if (calendarListo) {
    redirect(`/${cuenta.slug}/hoy`)
  }

  return (
    <main style={styles.container}>
      <h1 style={styles.title}>{cuenta.nombrePublico}</h1>
      <div style={styles.banner}>
        <p style={{ margin: 0 }}>
          Estamos preparando tu Google Calendar dedicado. Refrescá en un minuto.
        </p>
      </div>
      <p style={styles.hint}>
        Cuando termine, este link te va a llevar directo al panel del día.
      </p>
      <form action="/api/auth/logout" method="post" style={{ marginTop: '1.5rem' }}>
        <button type="submit" style={styles.logoutBtn}>Cerrar sesión</button>
      </form>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 480,
    margin: '3rem auto',
    padding: '0 1rem',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 600,
    color: '#111',
  },
  banner: {
    background: '#fff3cd',
    border: '1px solid #ffe08a',
    padding: '0.75rem 1rem',
    borderRadius: 8,
    marginTop: '1rem',
  },
  hint: {
    color: '#6b7280',
    marginTop: '1rem',
    fontSize: '0.9375rem',
  },
  logoutBtn: {
    padding: '0.5rem 1rem',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    background: '#fff',
    cursor: 'pointer',
  },
}
