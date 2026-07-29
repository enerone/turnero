import type { ReactNode } from 'react'

export default function AdminLayout({ children }: { children: ReactNode }) {
  const sidebarStyle: React.CSSProperties = {
    width: '200px',
    minHeight: '100vh',
    background: '#1e293b',
    color: '#f8fafc',
    display: 'flex',
    flexDirection: 'column',
    padding: '0',
    flexShrink: 0,
  }

  const headerStyle: React.CSSProperties = {
    padding: '20px 16px 16px',
    borderBottom: '1px solid #334155',
    fontSize: '13px',
    fontWeight: 700,
    color: '#94a3b8',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  }

  const navStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '12px 8px',
  }

  const linkStyle: React.CSSProperties = {
    display: 'block',
    padding: '8px 12px',
    borderRadius: '6px',
    color: '#cbd5e1',
    textDecoration: 'none',
    fontSize: '14px',
  }

  const logoutStyle: React.CSSProperties = {
    ...linkStyle,
    marginTop: 'auto',
    color: '#94a3b8',
    fontSize: '13px',
  }

  const bottomStyle: React.CSSProperties = {
    padding: '12px 8px',
    borderTop: '1px solid #334155',
    marginTop: 'auto',
  }

  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', display: 'flex', minHeight: '100vh', background: '#f1f5f9' }}>
        <aside style={sidebarStyle}>
          <div style={headerStyle}>Panel Admin</div>
          <nav style={navStyle}>
            <a href="/admin/cuentas" style={linkStyle}>Cuentas</a>
          </nav>
          <div style={bottomStyle}>
            <form action="/api/admin/logout" method="POST">
              <button
                type="submit"
                style={{
                  ...logoutStyle,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                }}
              >
                Cerrar sesion
              </button>
            </form>
          </div>
        </aside>
        <main style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
          {children}
        </main>
      </body>
    </html>
  )
}
