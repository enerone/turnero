type Props = { searchParams: Promise<{ error?: string }> }

const MENSAJES_ERROR: Record<string, string> = {
  denied: 'Cancelaste el acceso. Podés intentar de nuevo cuando quieras.',
  state: 'La sesión de login expiró. Probá de nuevo.',
  no_refresh:
    'Necesitamos permiso para acceder a tu Google Calendar. Aceptá los permisos cuando Google te pregunte.',
  oauth: 'Google rechazó el login. Probá de nuevo.',
  server: 'Algo se rompió de nuestro lado. Intentá de nuevo en un rato.',
}

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams

  return (
    <main
      style={{
        maxWidth: 480,
        margin: '4rem auto',
        padding: '0 1rem',
        fontFamily: 'system-ui',
      }}
    >
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Turnero</h1>
      <p style={{ color: '#555', marginBottom: '2rem' }}>
        Agenda con confirmación automática de turnos.
      </p>

      {error && MENSAJES_ERROR[error] && (
        <p
          style={{
            background: '#fee',
            border: '1px solid #f88',
            padding: '0.75rem 1rem',
            borderRadius: 4,
            marginBottom: '1rem',
          }}
        >
          {MENSAJES_ERROR[error]}
        </p>
      )}

      <a
        href="/api/auth/google"
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

      <p style={{ marginTop: '2rem', color: '#888', fontSize: '0.875rem' }}>
        Usamos tu cuenta de Google para el login y para sincronizar los turnos con tu Google
        Calendar.
      </p>
    </main>
  )
}
