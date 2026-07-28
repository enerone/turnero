'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getTenant } from '@/lib/tenant/resolve'
import { getSession } from '@/lib/auth/session'
import { normalizarTelefonoE164 } from '@/lib/format/telefono'

async function guardAuth() {
  const s = await getSession()
  if (!s) return { ok: false as const, error: 'No autenticado' }
  const { cuenta, db } = await getTenant()
  if (s.user.cuentaId !== cuenta.id) return { ok: false as const, error: 'Sin permisos' }
  return { ok: true as const, s, cuenta, db }
}

// ─── CREAR ────────────────────────────────────────────────────

const CrearClienteSchema = z.object({
  nombre: z.string().min(1).max(120),
  telefono: z.string().min(6).max(30),
  email: z.string().email().optional().or(z.literal('')),
  notas: z.string().max(1000).optional(),
})

export async function crearCliente(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = CrearClienteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' }

  const guard = await guardAuth()
  if (!guard.ok) return guard
  const { db, cuenta } = guard

  const telefono = normalizarTelefonoE164(parsed.data.telefono)
  if (!telefono) return { ok: false, error: 'Teléfono inválido (incluí código de país, ej: +54 9 11…)' }

  try {
    await db.cliente.create({
      data: {
        nombre: parsed.data.nombre.trim(),
        telefono,
        email: parsed.data.email?.trim() || null,
        notas: parsed.data.notas?.trim() ?? '',
      } as any,
    })
  } catch (err) {
    if (err instanceof Error && err.message.includes('Unique constraint')) {
      return { ok: false, error: 'Ya existe un contacto con ese teléfono' }
    }
    throw err
  }

  revalidatePath(`/${cuenta.slug}/contactos`)
  return { ok: true }
}

// ─── ACTUALIZAR ───────────────────────────────────────────────

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

// ─── BORRAR ───────────────────────────────────────────────────

const BorrarClienteSchema = z.object({ id: z.string().uuid() })

export async function borrarCliente(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = BorrarClienteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' }

  const guard = await guardAuth()
  if (!guard.ok) return guard
  const { db, cuenta } = guard

  const existente = await db.cliente.findUnique({ where: { id: parsed.data.id } })
  if (!existente) return { ok: false, error: 'Contacto no encontrado' }

  // onDelete: SetNull en Turno — los turnos quedan, clienteId pasa a null.
  await db.cliente.delete({ where: { id: parsed.data.id } })

  revalidatePath(`/${cuenta.slug}/contactos`)
  return { ok: true }
}
