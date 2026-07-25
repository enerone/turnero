import { basePrisma } from '@/lib/db/base-prisma'
import type { Usuario } from '@prisma/client'

export interface DatosGoogleParaAceptar {
  googleSub: string
  email: string
  nombre: string
}

interface InvitacionLookup {
  id: string
  cuenta_id: string
  email: string
  expira_en: Date
  aceptada_en: Date | null
}

export async function aceptarInvitacion(
  token: string,
  google: DatosGoogleParaAceptar,
): Promise<Usuario> {
  // Lookup via función SECURITY DEFINER (bypasea RLS solo para este SELECT).
  const filas = await basePrisma.$queryRaw<InvitacionLookup[]>`
    SELECT * FROM lookup_invitacion_por_token(${token})
  `
  const inv = filas[0]
  if (!inv) throw new Error('Invitación no existe o es inválida')
  if (inv.aceptada_en) throw new Error('Invitación ya fue aceptada')
  if (new Date(inv.expira_en) < new Date()) throw new Error('Invitación expirada')

  // Ahora hago los writes con RLS aplicando sobre la cuenta correcta
  return basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.cuenta_id', ${inv.cuenta_id}, TRUE)`

    const usuario = await tx.usuario.create({
      data: {
        cuentaId: inv.cuenta_id,
        googleSub: google.googleSub,
        email: google.email.toLowerCase(),
        nombre: google.nombre,
        rol: 'secretaria',
      },
    })

    await tx.invitacion.update({
      where: { id: inv.id },
      data: { aceptadaEn: new Date() },
    })

    return usuario
  })
}
