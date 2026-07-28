'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Props {
  slug: string
  /** Página activa para marcarla visualmente */
  activa?: 'hoy' | 'semana' | 'config'
}

export function PanelMenu({ slug, activa }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [cerrando, setCerrando] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  function cerrar() {
    setCerrando(true)
    setTimeout(() => { setAbierto(false); setCerrando(false) }, 180)
  }

  // Cerrar con Escape
  useEffect(() => {
    if (!abierto) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [abierto])

  // Bloquear scroll del body cuando está abierto
  useEffect(() => {
    document.body.style.overflow = abierto ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [abierto])

  async function handleLogout() {
    cerrar()
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <>
      <button
        aria-label="Menú"
        onClick={() => setAbierto(true)}
        style={styles.trigger}
      >
        <span style={styles.bar} />
        <span style={styles.bar} />
        <span style={styles.bar} />
      </button>

      {abierto && (
        <>
          {/* Overlay */}
          <div
            onClick={cerrar}
            style={{
              ...styles.overlay,
              opacity: cerrando ? 0 : 1,
            }}
          />

          {/* Drawer */}
          <div
            ref={drawerRef}
            style={{
              ...styles.drawer,
              transform: cerrando ? 'translateX(100%)' : 'translateX(0)',
            }}
          >
            <button onClick={cerrar} style={styles.closeBtn} aria-label="Cerrar menú">✕</button>

            <nav style={styles.nav}>
              <NavItem href={`/${slug}/hoy`} activa={activa === 'hoy'} onClick={cerrar}>
                Hoy
              </NavItem>
              <NavItem href={`/${slug}/semana`} activa={activa === 'semana'} onClick={cerrar}>
                Semana
              </NavItem>
              <NavItem href={`/${slug}/config`} activa={activa === 'config'} onClick={cerrar}>
                Configuración
              </NavItem>
              <NavItem href={`/${slug}/reservar`} external onClick={cerrar}>
                Ver página de reservas
              </NavItem>
            </nav>

            <div style={styles.footer}>
              <button onClick={handleLogout} style={styles.logoutBtn}>
                Cerrar sesión
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function NavItem({
  href, activa, external, onClick, children,
}: {
  href: string
  activa?: boolean
  external?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      onClick={onClick}
      style={{ ...styles.navItem, ...(activa ? styles.navItemActivo : {}) }}
    >
      {children}
      {external && <span style={styles.extIcon}>↗</span>}
    </Link>
  )
}

const styles: Record<string, React.CSSProperties> = {
  trigger: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    padding: '6px 8px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    borderRadius: 6,
  },
  bar: {
    display: 'block',
    width: 22,
    height: 2,
    background: '#374151',
    borderRadius: 2,
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.35)',
    zIndex: 50,
    transition: 'opacity 180ms ease',
  },
  drawer: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: 260,
    background: '#fff',
    boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
    zIndex: 51,
    display: 'flex',
    flexDirection: 'column',
    transition: 'transform 180ms ease',
  },
  closeBtn: {
    alignSelf: 'flex-end',
    margin: '1rem 1rem 0',
    background: 'none',
    border: 'none',
    fontSize: '1.125rem',
    color: '#6b7280',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 6,
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    padding: '1.25rem 0',
    flex: 1,
  },
  navItem: {
    padding: '0.875rem 1.5rem',
    fontSize: '1rem',
    fontWeight: 500,
    color: '#111',
    textDecoration: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    borderLeft: '3px solid transparent',
  },
  navItemActivo: {
    color: '#0ea5e9',
    borderLeftColor: '#0ea5e9',
    background: '#f0f9ff',
  },
  extIcon: {
    fontSize: '0.75rem',
    color: '#9ca3af',
  },
  footer: {
    padding: '1rem 1.5rem',
    borderTop: '1px solid #e5e7eb',
  },
  logoutBtn: {
    width: '100%',
    padding: '0.625rem 1rem',
    background: 'none',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    fontSize: '0.9375rem',
    color: '#6b7280',
    cursor: 'pointer',
    fontWeight: 500,
    textAlign: 'center',
  },
}
