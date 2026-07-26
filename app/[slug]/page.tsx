import { getTenant } from '@/lib/tenant/resolve'
import { getSession } from '@/lib/auth/session'
import { redirect } from 'next/navigation'

export default async function PanelHomePage() {
  const { cuenta, db } = await getTenant()
  const s = await getSession()
  if (!s) redirect('/login')

  const integracion = await db.integracionCalendar.findUnique({
    where: { cuentaId: cuenta.id },
  })
  const calendarListo = !!integracion?.calendarIdDedicado

  return (
    <main
      style={{
        maxWidth: 640,
        margin: '2rem auto',
        padding: '0 1rem',
        fontFamily: 'system-ui',
      }}
    >
      <h1 style={{ fontSize: '1.5rem' }}>¡Bienvenida a {cuenta.nombrePublico}!</h1>

      {!calendarListo && (
        <p
          style={{
            background: '#fff3cd',
            border: '1px solid #ffe08a',
            padding: '0.75rem 1rem',
            borderRadius: 4,
            marginTop: '1rem',
          }}
        >
          Estamos preparando tu Google Calendar dedicado. Refrescá en un minuto.
        </p>
      )}

      <p style={{ color: '#555', marginTop: '1rem' }}>
        Tu agenda está lista. El panel completo (lista mobile + grilla desktop) llega en el
        Plan 4.
      </p>
      <p style={{ color: '#555' }}>
        Mientras tanto, podés verificar el estado del tenant en{' '}
        <a href={`/${cuenta.slug}/debug`}>/{cuenta.slug}/debug</a>.
      </p>
      <form action="/api/auth/logout" method="post" style={{ marginTop: '1.5rem' }}>
        <button type="submit" style={{ padding: '0.5rem 1rem' }}>
          Cerrar sesión
        </button>
      </form>
    </main>
  )
}
