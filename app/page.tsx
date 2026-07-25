import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { basePrisma } from '@/lib/db/base-prisma'

export default async function LandingPage() {
  const s = await getSession()
  if (s) {
    const usuario = await basePrisma.usuario.findUnique({
      where: { id: s.user.id },
      include: { cuenta: { select: { slug: true } } },
    })
    if (usuario) redirect(`/${usuario.cuenta.slug}`)
  }

  return (
    <main
      style={{
        maxWidth: 480,
        margin: '4rem auto',
        padding: '0 1rem',
        fontFamily: 'system-ui',
      }}
    >
      <h1 style={{ fontSize: '2rem' }}>Turnero</h1>
      <p style={{ color: '#555' }}>Agenda con confirmación automática de turnos.</p>
      <p style={{ marginTop: '2rem' }}>
        <a
          href="/login"
          style={{
            display: 'inline-block',
            padding: '0.75rem 1.5rem',
            background: '#0ea5e9',
            color: 'white',
            textDecoration: 'none',
            borderRadius: 4,
            fontWeight: 600,
          }}
        >
          Entrar
        </a>
      </p>
    </main>
  )
}
