'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getTenant } from '@/lib/tenant/resolve'
import { getSession } from '@/lib/auth/session'

async function guardAuth() {
  const s = await getSession()
  if (!s) return { ok: false as const, error: 'No autenticado' }
  const { cuenta, db } = await getTenant()
  if (s.user.cuentaId !== cuenta.id) return { ok: false as const, error: 'Sin permisos' }
  return { ok: true as const, s, cuenta, db }
}

const ActualizarClienteSchema = z.object({
  id: z.string().uuid(),
  nombre: z.string().min(1).max(120).optional(),
  email: z.string().email().optional().or(z.literal('')),
  notas: z.string().max(1000).optional(),
})

export async function actualizarCliente(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = ActualizarClienteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' }

  const guard = await guardAuth()
  if (!guard.ok) return guard

  const { db, cuenta } = guard
  const { id, email, ...rest } = parsed.data

  const existente = await db.cliente.findUnique({ where: { id } })
  if (!existente) return { ok: false, error: 'Contacto no encontrado' }

  await db.cliente.update({
    where: { id },
    data: {
      ...rest,
      ...(rest.nombre !== undefined ? { nombre: rest.nombre.trim() } : {}),
      ...(email !== undefined ? { email: email.trim() || null } : {}),
    },
  })

  revalidatePath(`/${cuenta.slug}/contactos`)
  return { ok: true }
}
