'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { validarSlug } from '@/lib/tenant/validate-slug'
import {
  NOMBRE_COOKIE_PENDING,
  deserializarPendingOnboarding,
} from '@/lib/auth/pending-onboarding'
import { completarOnboarding } from '@/lib/onboarding/completar'
import { lucia } from '@/lib/auth/lucia'
import { env } from '@/lib/shared/env'
import { logger } from '@/lib/shared/logger'

const schemaForm = z.object({
  slug: z.string(),
  nombrePublico: z.string().min(2).max(120),
  telefonoWhatsapp: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Formato E.164'),
  duracionMinutos: z.coerce.number().int().min(5).max(240),
})

const HORARIOS_DEFAULT = [0, 1, 2, 3, 4].flatMap((diaSemana) => [
  { diaSemana, desde: '09:00', hasta: '13:00' },
  { diaSemana, desde: '15:00', hasta: '18:00' },
])

export type EstadoOnboarding =
  | { ok: false; error: string }
  | { ok: true; redirectTo: string }

export async function completarOnboardingAction(
  _prev: EstadoOnboarding | null,
  formData: FormData,
): Promise<EstadoOnboarding> {
  const cookieStore = await cookies()
  const pendingCookie = cookieStore.get(NOMBRE_COOKIE_PENDING)?.value
  if (!pendingCookie) {
    return { ok: false, error: 'La sesión de onboarding expiró. Volvé a entrar con Google.' }
  }

  let pending
  try {
    pending = await deserializarPendingOnboarding(pendingCookie, env.SESSION_SECRET)
  } catch {
    return { ok: false, error: 'La sesión de onboarding es inválida. Volvé a entrar con Google.' }
  }

  const parsed = schemaForm.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    const firstError = Object.values(parsed.error.flatten().fieldErrors).flat()[0]
    return { ok: false, error: firstError ?? 'Datos inválidos' }
  }

  const slugCheck = validarSlug(parsed.data.slug)
  if (!slugCheck.valido) {
    return { ok: false, error: `Slug: ${slugCheck.razon}` }
  }

  try {
    const { cuenta, usuario } = await completarOnboarding(
      {
        googleSub: pending.googleSub,
        email: pending.email,
        nombre: pending.nombre,
        refreshToken: pending.refreshToken,
      },
      {
        slug: parsed.data.slug,
        nombrePublico: parsed.data.nombrePublico,
        telefonoWhatsapp: parsed.data.telefonoWhatsapp,
        duracionMinutos: parsed.data.duracionMinutos,
        horarios: HORARIOS_DEFAULT,
      },
    )

    const session = await lucia.createSession(usuario.id, {})
    const sessionCookie = lucia.createSessionCookie(session.id)
    cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
    cookieStore.delete(NOMBRE_COOKIE_PENDING)

    logger.info({ cuentaId: cuenta.id, usuarioId: usuario.id }, 'onboarding completado')
    return { ok: true, redirectTo: `/${cuenta.slug}` }
  } catch (e: unknown) {
    logger.warn({ err: e }, 'completarOnboarding falló')
    const msg = e instanceof Error ? e.message : 'error desconocido'
    if (msg.includes('Unique constraint') || msg.includes('unique constraint')) {
      return { ok: false, error: 'Ese slug ya está tomado. Elegí otro.' }
    }
    return { ok: false, error: 'No pudimos crear tu cuenta. Reintentá en un rato.' }
  }
}

export async function redirectDespuesDeOnboarding(destino: string) {
  redirect(destino)
}
