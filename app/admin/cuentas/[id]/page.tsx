import { notFound } from 'next/navigation'
import { basePrisma } from '@/lib/db/base-prisma'

export const dynamic = 'force-dynamic'

export default async function DetalleCuentaAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ creada?: string; usuarioId?: string }>
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams])

  const cuenta = await basePrisma.cuenta.findUnique({
    where: { id },
    include: {
      usuarios: {
        select: { id: true, email: true, nombre: true, rol: true, createdAt: true },
        orderBy: { rol: 'asc' },
      },
      integracionCalendar: {
        select: { calendarIdDedicado: true, createdAt: true },
      },
      turnos: {
        orderBy: { inicio: 'desc' },
        take: 5,
        include: {
          cliente: { select: { nombre: true, telefono: true } },
          servicio: { select: { nombre: true } },
        },
      },
    },
  })

  if (!cuenta) notFound()

  const ownerUsuario = cuenta.usuarios.find((u) => u.rol === 'owner')

  const cardStyle: React.CSSProperties = {
    background: '#fff',
    borderRadius: '10px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    padding: '24px',
    marginBottom: '24px',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: '4px',
  }

  const valueStyle: React.CSSProperties = {
    fontSize: '15px',
    color: '#1e293b',
    marginBottom: '16px',
  }

  const thStyle: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    borderBottom: '1px solid #e2e8f0',
  }

  const tdStyle: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: '14px',
    color: '#334155',
    borderBottom: '1px solid #f1f5f9',
    verticalAlign: 'middle',
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <a href="/admin/cuentas" style={{ color: '#64748b', textDecoration: 'none', fontSize: '14px' }}>
          Cuentas
        </a>
        <span style={{ color: '#94a3b8' }}>/</span>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
          {cuenta.nombrePublico}
        </h1>
      </div>

      {sp.creada === '1' && sp.usuarioId && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ fontWeight: 600, color: '#166534', marginBottom: '0.5rem' }}>Cuenta creada. Compartile este link al cliente para que entre:</div>
          <code style={{ display: 'block', background: '#dcfce7', padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.875rem', color: '#15803d', wordBreak: 'break-all' }}>
            {process.env.PUBLIC_BASE_URL}/test/login-as?usuarioId={sp.usuarioId}&cuentaId={id}
          </code>
          <div style={{ fontSize: '0.75rem', color: '#4ade80', marginTop: '0.375rem' }}>Solo funciona en dev. En producción configurar Google OAuth con el email del owner.</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
        <div style={cardStyle}>
          <h2 style={{ margin: '0 0 20px', fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>
            Informacion de la cuenta
          </h2>
          <div>
            <div style={labelStyle}>Slug</div>
            <div style={valueStyle}>/{cuenta.slug}</div>
          </div>
          <div>
            <div style={labelStyle}>Nombre publico</div>
            <div style={valueStyle}>{cuenta.nombrePublico}</div>
          </div>
          <div>
            <div style={labelStyle}>Timezone</div>
            <div style={valueStyle}>{cuenta.timezone}</div>
          </div>
          <div>
            <div style={labelStyle}>Telefono WhatsApp</div>
            <div style={valueStyle}>{cuenta.telefonoWhatsapp ?? '—'}</div>
          </div>
          <div>
            <div style={labelStyle}>Color</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '18px',
                  height: '18px',
                  borderRadius: '4px',
                  background: cuenta.color,
                  border: '1px solid #e2e8f0',
                }}
              />
              <span style={{ fontSize: '15px', color: '#1e293b' }}>{cuenta.color}</span>
            </div>
          </div>
          <div>
            <div style={labelStyle}>Subdominio activo</div>
            <div style={valueStyle}>{cuenta.subdominioActivo ? 'Si' : 'No'}</div>
          </div>
          <div>
            <div style={labelStyle}>Calendario dedicado</div>
            <div style={valueStyle}>
              {cuenta.integracionCalendar?.calendarIdDedicado ?? (
                <span style={{ color: '#f59e0b' }}>Pendiente</span>
              )}
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <h2 style={{ margin: '0 0 20px', fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>
            Impersonar
          </h2>
          <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '20px' }}>
            Iniciá sesion como el owner de esta cuenta. Esto reemplaza tu sesion actual.
          </p>
          {ownerUsuario ? (
            <form action="/api/admin/impersonar" method="POST">
              <input type="hidden" name="cuentaId" value={cuenta.id} />
              <button
                type="submit"
                style={{
                  padding: '10px 20px',
                  background: '#0ea5e9',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Impersonar owner
              </button>
              <div style={{ marginTop: '12px', color: '#64748b', fontSize: '13px' }}>
                {ownerUsuario.nombre} — {ownerUsuario.email}
              </div>
            </form>
          ) : (
            <p style={{ color: '#94a3b8', fontSize: '14px' }}>Esta cuenta no tiene owner.</p>
          )}
        </div>
      </div>

      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>
          Usuarios ({cuenta.usuarios.length})
        </h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Nombre</th>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Rol</th>
              <th style={thStyle}>Alta</th>
            </tr>
          </thead>
          <tbody>
            {cuenta.usuarios.map((u) => (
              <tr key={u.id}>
                <td style={tdStyle}>{u.nombre}</td>
                <td style={tdStyle}>{u.email}</td>
                <td style={tdStyle}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: '999px',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: u.rol === 'owner' ? '#dbeafe' : '#f1f5f9',
                      color: u.rol === 'owner' ? '#1d4ed8' : '#475569',
                    }}
                  >
                    {u.rol}
                  </span>
                </td>
                <td style={{ ...tdStyle, color: '#94a3b8', fontSize: '13px' }}>
                  {u.createdAt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>
          Ultimos 5 turnos
        </h2>
        {cuenta.turnos.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: '14px' }}>Sin turnos todavia.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Fecha y hora</th>
                <th style={thStyle}>Cliente</th>
                <th style={thStyle}>Servicio</th>
                <th style={thStyle}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {cuenta.turnos.map((t) => (
                <tr key={t.id}>
                  <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums', fontSize: '13px' }}>
                    {t.inicio.toLocaleString('es-AR', {
                      timeZone: cuenta.timezone,
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td style={tdStyle}>
                    {t.cliente?.nombre ?? <span style={{ color: '#94a3b8' }}>—</span>}
                    {t.cliente?.telefono && (
                      <span style={{ display: 'block', fontSize: '12px', color: '#94a3b8' }}>
                        {t.cliente.telefono}
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>{t.servicio.nombre}</td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: '13px', color: '#64748b' }}>{t.estado}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
