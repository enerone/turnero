import { redirect } from 'next/navigation'
import { basePrisma } from '@/lib/db/base-prisma'
import { normalizarTelefonoE164 } from '@/lib/format/telefono'
import { env } from '@/lib/shared/env'

export const dynamic = 'force-dynamic'

async function crearCuenta(formData: FormData) {
  'use server'

  const nombre = (formData.get('nombre') as string)?.trim()
  const slug = (formData.get('slug') as string)?.trim().toLowerCase()
  const email = (formData.get('email') as string)?.trim()
  const telefonoRaw = (formData.get('telefono') as string)?.trim()
  const timezone = (formData.get('timezone') as string) || 'America/Argentina/Buenos_Aires'

  if (!nombre || !slug || !email) {
    redirect('/admin/cuentas/nueva?error=campos_requeridos')
  }

  const telefono = telefonoRaw ? normalizarTelefonoE164(telefonoRaw) : null

  const slugExiste = await basePrisma.cuenta.findUnique({ where: { slug } })
  if (slugExiste) redirect('/admin/cuentas/nueva?error=slug_ocupado')

  const emailExiste = await basePrisma.usuario.findFirst({ where: { email } })
  if (emailExiste) redirect('/admin/cuentas/nueva?error=email_ocupado')

  const cuenta = await basePrisma.cuenta.create({
    data: {
      slug,
      nombrePublico: nombre,
      telefonoWhatsapp: telefono,
      timezone,
    },
  })

  const usuario = await basePrisma.usuario.create({
    data: {
      cuentaId: cuenta.id,
      email,
      nombre,
      googleSub: `admin-created-${cuenta.id}`,
      rol: 'owner',
    },
  })

  // Servicios y horarios por defecto
  await basePrisma.servicio.create({
    data: { cuentaId: cuenta.id, nombre: 'Consulta', duracionMinutos: 30, esDefault: true, activo: true },
  })
  const dias = [1, 2, 3, 4, 5]
  await basePrisma.horarioSemanal.createMany({
    data: dias.flatMap((d) => [
      { cuentaId: cuenta.id, diaSemana: d, desde: new Date(Date.UTC(1970, 0, 1, 9, 0)), hasta: new Date(Date.UTC(1970, 0, 1, 13, 0)) },
      { cuentaId: cuenta.id, diaSemana: d, desde: new Date(Date.UTC(1970, 0, 1, 15, 0)), hasta: new Date(Date.UTC(1970, 0, 1, 18, 0)) },
    ]),
  })

  redirect(`/admin/cuentas/${cuenta.id}?creada=1&usuarioId=${usuario.id}`)
}

const ERRORES: Record<string, string> = {
  campos_requeridos: 'Completá nombre, slug y email.',
  slug_ocupado: 'Ese slug ya está en uso.',
  email_ocupado: 'Ya existe un usuario con ese email.',
}

interface Props { searchParams: Promise<{ error?: string }> }

export default async function NuevaCuentaPage({ searchParams }: Props) {
  const { error } = await searchParams

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <a href="/admin/cuentas" style={styles.back}>← Volver</a>
        <h1 style={styles.h1}>Nueva cuenta</h1>
      </div>

      {error && <div style={styles.errorBox}>{ERRORES[error] ?? 'Error desconocido.'}</div>}

      <form action={crearCuenta} style={styles.form}>
        <label style={styles.label}>
          Nombre del consultorio / negocio *
          <input name="nombre" required style={styles.input} placeholder="Dra. García — Kinesiología" />
        </label>

        <label style={styles.label}>
          Slug (URL pública) *
          <div style={styles.slugWrap}>
            <span style={styles.slugPre}>{env.PUBLIC_BASE_URL}/</span>
            <input name="slug" required style={{ ...styles.input, flex: 1 }} placeholder="dra-garcia" pattern="[a-z0-9-]+" />
          </div>
          <span style={styles.hint}>Solo minúsculas, números y guiones.</span>
        </label>

        <label style={styles.label}>
          Email del owner *
          <input name="email" type="email" required style={styles.input} placeholder="dra@ejemplo.com" />
          <span style={styles.hint}>Con este email va a poder hacer login con Google.</span>
        </label>

        <label style={styles.label}>
          Teléfono WhatsApp
          <input name="telefono" style={styles.input} placeholder="+54 9 11 1234 5678" />
        </label>

        <label style={styles.label}>
          Zona horaria
          <select name="timezone" style={styles.input}>
            <option value="America/Argentina/Buenos_Aires">Argentina (BUE)</option>
            <option value="America/Montevideo">Uruguay (MVD)</option>
            <option value="America/Santiago">Chile (SCL)</option>
            <option value="America/Bogota">Colombia (BOG)</option>
            <option value="America/Lima">Perú (LIM)</option>
            <option value="America/Mexico_City">México (MEX)</option>
          </select>
        </label>

        <button type="submit" style={styles.btn}>Crear cuenta</button>
      </form>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 560 },
  header: { display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' },
  back: { color: '#64748b', textDecoration: 'none', fontSize: '0.875rem' },
  h1: { margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' },
  errorBox: { background: '#fef2f2', border: '1px solid #fca5a5', color: '#7f1d1d', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: '0.875rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '1.25rem', background: '#fff', padding: '1.5rem', borderRadius: 12, border: '1px solid #e2e8f0' },
  label: { display: 'flex', flexDirection: 'column', gap: '0.375rem', fontSize: '0.875rem', fontWeight: 500, color: '#374151' },
  input: { padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: '0.9375rem', outline: 'none' },
  slugWrap: { display: 'flex', alignItems: 'center', gap: 0 },
  slugPre: { padding: '0.5rem 0.75rem', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRight: 'none', borderRadius: '8px 0 0 8px', fontSize: '0.875rem', color: '#64748b', whiteSpace: 'nowrap' },
  hint: { fontSize: '0.75rem', color: '#94a3b8', fontWeight: 400 },
  btn: { padding: '0.625rem 1.5rem', background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.9375rem', fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' },
}
