export default async function LoginAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams
  const hayError = params.error === '1'

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f1f5f9',
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '10px',
          padding: '40px 36px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          width: '320px',
        }}
      >
        <h1 style={{ margin: '0 0 8px', fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>
          Panel Admin
        </h1>
        <p style={{ margin: '0 0 28px', color: '#64748b', fontSize: '14px' }}>Turnero</p>

        {hayError && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              padding: '10px 14px',
              marginBottom: '20px',
              color: '#dc2626',
              fontSize: '14px',
            }}
          >
            Contrasena incorrecta.
          </div>
        )}

        <form action="/api/admin/login" method="POST">
          <div style={{ marginBottom: '20px' }}>
            <label
              htmlFor="password"
              style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500, color: '#374151' }}
            >
              Contrasena
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              style={{
                width: '100%',
                padding: '9px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '15px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <button
            type="submit"
            style={{
              width: '100%',
              padding: '10px',
              background: '#0ea5e9',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '15px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Ingresar
          </button>
        </form>
      </div>
    </div>
  )
}
