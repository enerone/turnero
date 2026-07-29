import { basePrisma } from '@/lib/db/base-prisma'

export const dynamic = 'force-dynamic'

export default async function CuentasAdminPage() {
  const cuentas = await basePrisma.cuenta.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { turnos: true, clientes: true, usuarios: true },
      },
      integracionCalendar: {
        select: { calendarIdDedicado: true, createdAt: true },
      },
      usuarios: {
        where: { rol: 'owner' },
        select: { email: true, nombre: true },
        take: 1,
      },
    },
  })

  const thStyle: React.CSSProperties = {
    padding: '10px 14px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    borderBottom: '1px solid #e2e8f0',
    whiteSpace: 'nowrap',
  }

  const tdStyle: React.CSSProperties = {
    padding: '12px 14px',
    fontSize: '14px',
    color: '#334155',
    borderBottom: '1px solid #f1f5f9',
    verticalAlign: 'middle',
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>Cuentas</h1>
        <a href="/admin/cuentas/nueva" style={{ padding: '8px 16px', background: '#0ea5e9', color: '#fff', borderRadius: 8, textDecoration: 'none', fontSize: '14px', fontWeight: 600 }}>
          + Nueva cuenta
        </a>
      </div>
      <div
        style={{
          background: '#fff',
          borderRadius: '10px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Cuenta</th>
              <th style={thStyle}>Owner</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Turnos</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Clientes</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Calendar</th>
              <th style={thStyle}>Creada</th>
            </tr>
          </thead>
          <tbody>
            {cuentas.map((cuenta) => {
              const owner = cuenta.usuarios[0]
              const tieneCalendar = !!cuenta.integracionCalendar?.calendarIdDedicado
              return (
                <tr key={cuenta.id}>
                  <td style={tdStyle}>
                    <a
                      href={`/admin/cuentas/${cuenta.id}`}
                      style={{ fontWeight: 600, color: '#0ea5e9', textDecoration: 'none' }}
                    >
                      {cuenta.nombrePublico}
                    </a>
                    <span style={{ marginLeft: '8px', color: '#94a3b8', fontSize: '12px' }}>
                      /{cuenta.slug}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {owner ? (
                      <span>
                        {owner.nombre}
                        <span style={{ color: '#94a3b8', fontSize: '12px', display: 'block' }}>
                          {owner.email}
                        </span>
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>—</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {cuenta._count.turnos}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {cuenta._count.clientes}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: tieneCalendar ? '#22c55e' : '#e2e8f0',
                      }}
                    />
                  </td>
                  <td style={{ ...tdStyle, color: '#94a3b8', fontSize: '13px' }}>
                    {cuenta.createdAt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </td>
                </tr>
              )
            })}
            {cuentas.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: '32px' }}>
                  No hay cuentas todavia.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
