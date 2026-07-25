import { basePrisma } from '@/lib/db/base-prisma'

type Props = { params: Promise<{ token: string }> }

interface InvitacionLookup {
  id: string
  cuenta_id: string
  email: string
  expira_en: Date
  aceptada_en: Date | null
}

async function lookupInvitacion(token: string) {
  const filas = await basePrisma.$queryRaw<InvitacionLookup[]>`
    SELECT * FROM lookup_invitacion_por_token(${token})
  `
  return filas[0]
}

async function nombreCuenta(cuentaId: string): Promise<string | null> {
  const c = await basePrisma.cuenta.findUnique({
    where: { id: cuentaId },
    select: { nombrePublico: true },
  })
  return c?.nombrePublico ?? null
}

export default async function AceptarInvitacionPage({ params }: Props) {
  const { token } = await params
  const inv = await lookupInvitacion(token)

  if (!inv || inv.aceptada_en || new Date(inv.expira_en) < new Date()) {
    return (
      <main
        style={{
          maxWidth: 480,
          margin: '4rem auto',
          padding: '0 1rem',
          fontFamily: 'system-ui',
        }}
      >
        <h1>Invitación no válida</h1>
        <p>Este link ya se usó o expiró. Pedile al owner que te mande uno nuevo.</p>
      </main>
    )
  }

  const nombre = await nombreCuenta(inv.cuenta_id)

  return (
    <main
      style={{
        maxWidth: 480,
        margin: '4rem auto',
        padding: '0 1rem',
        fontFamily: 'system-ui',
      }}
    >
      <h1 style={{ fontSize: '1.5rem' }}>Te invitaron a Turnero</h1>
      <p>
        <strong>{nombre ?? 'Un estudio'}</strong> te invita a colaborar en su agenda.
      </p>
      <p style={{ marginTop: '1.5rem' }}>
        <a
          href={`/api/auth/google?intent=invitacion&token=${encodeURIComponent(token)}`}
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
          Continuar con Google
        </a>
      </p>
    </main>
  )
}
