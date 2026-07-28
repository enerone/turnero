'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getTenant } from '@/lib/tenant/resolve'
import { getSession } from '@/lib/auth/session'
import { puede } from '@/lib/auth/puede'
import { escribirAudit } from '@/lib/audit/log'
import { normalizarTelefonoE164 } from '@/lib/format/telefono'

export interface AccionResult {
  ok: boolean
  error?: string
}

async function guardOwner(): Promise<
  | { ok: true; s: NonNullable<Awaited<ReturnType<typeof getSession>>>; cuenta: Awaited<ReturnType<typeof getTenant>>['cuenta']; db: Awaited<ReturnType<typeof getTenant>>['db'] }
  | { ok: false; error: string }
> {
  const s = await getSession()
  if (!s) return { ok: false, error: 'No autenticado' }
  const { cuenta, db } = await getTenant()
  if (s.user.cuentaId !== cuenta.id) return { ok: false, error: 'Sin permisos' }
  if (!puede({ rol: s.user.rol, cuentaId: s.user.cuentaId }, 'editar_config')) {
    return { ok: false, error: 'Sin permisos: sólo el dueño puede editar configuración' }
  }
  return { ok: true, s, cuenta, db }
}

// ─────────────────────────────────────────────────────────────
// SERVICIOS
// ─────────────────────────────────────────────────────────────

const CrearServicioSchema = z.object({
  nombre: z.string().min(1).max(80),
  duracionMinutos: z.number().int().min(5).max(480),
  esDefault: z.boolean().optional(),
  permiteSobreturnos: z.boolean().optional(),
})

export async function crearServicio(input: unknown): Promise<AccionResult> {
  const parsed = CrearServicioSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' }
  const guard = await guardOwner()
  if (!guard.ok) return guard

  const { db, cuenta, s } = guard
  const data = parsed.data

  if (data.esDefault) {
    // Sólo un servicio puede ser default a la vez.
    await db.servicio.updateMany({ where: { esDefault: true }, data: { esDefault: false } })
  }

  const servicio = await db.servicio.create({
    data: {
      nombre: data.nombre.trim(),
      duracionMinutos: data.duracionMinutos,
      esDefault: !!data.esDefault,
      permiteSobreturnos: !!data.permiteSobreturnos,
      activo: true,
    } as any,
  })

  await escribirAudit(db, {
    accion: 'cliente_creado', // reuse; no tenemos 'servicio_creado' en AccionAudit
    entidad: 'cuenta',
    entidadId: cuenta.id,
    usuarioId: s.user.id,
    payload: { subaccion: 'servicio_creado', servicioId: servicio.id, nombre: servicio.nombre },
  })

  revalidatePath(`/${cuenta.slug}/config`)
  return { ok: true }
}

const ActualizarServicioSchema = z.object({
  id: z.string().uuid(),
  nombre: z.string().min(1).max(80).optional(),
  duracionMinutos: z.number().int().min(5).max(480).optional(),
  activo: z.boolean().optional(),
  esDefault: z.boolean().optional(),
  permiteSobreturnos: z.boolean().optional(),
})

export async function actualizarServicio(input: unknown): Promise<AccionResult> {
  const parsed = ActualizarServicioSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' }
  const guard = await guardOwner()
  if (!guard.ok) return guard
  const { db, cuenta, s } = guard
  const { id, esDefault, ...rest } = parsed.data

  const existente = await db.servicio.findUnique({ where: { id } })
  if (!existente) return { ok: false, error: 'Servicio no encontrado' }

  if (esDefault === true) {
    await db.servicio.updateMany({ where: { esDefault: true }, data: { esDefault: false } })
  }

  await db.servicio.update({
    where: { id },
    data: {
      ...rest,
      ...(rest.nombre !== undefined ? { nombre: rest.nombre.trim() } : {}),
      ...(esDefault !== undefined ? { esDefault } : {}),
    },
  })

  await escribirAudit(db, {
    accion: 'cliente_actualizado',
    entidad: 'cuenta',
    entidadId: cuenta.id,
    usuarioId: s.user.id,
    payload: { subaccion: 'servicio_actualizado', servicioId: id, cambios: parsed.data },
  })

  revalidatePath(`/${cuenta.slug}/config`)
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────
// HORARIOS SEMANALES
// Estrategia simple: reemplazar todos los horarios en una sola transacción.
// El schema tiene @@index([cuentaId, diaSemana]) sin unique, así que se
// permiten múltiples franjas por día (mañana/tarde).
// ─────────────────────────────────────────────────────────────

const FranjaSchema = z.object({
  diaSemana: z.number().int().min(0).max(6),
  desde: z.string().regex(/^\d{2}:\d{2}$/, 'formato HH:MM'),
  hasta: z.string().regex(/^\d{2}:\d{2}$/, 'formato HH:MM'),
})

const ReemplazarHorariosSchema = z.object({
  franjas: z.array(FranjaSchema),
})

function hhmmToTimeDate(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(1970, 0, 1, h, m, 0))
}

export async function reemplazarHorariosSemanales(input: unknown): Promise<AccionResult> {
  const parsed = ReemplazarHorariosSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' }
  const guard = await guardOwner()
  if (!guard.ok) return guard
  const { db, cuenta, s } = guard

  // Validar franjas: desde < hasta.
  for (const f of parsed.data.franjas) {
    if (f.desde >= f.hasta) {
      return { ok: false, error: `Franja del día ${f.diaSemana}: "desde" debe ser anterior a "hasta"` }
    }
  }

  await db.$transaction([
    db.horarioSemanal.deleteMany({}),
    ...parsed.data.franjas.map((f) => db.horarioSemanal.create({
      data: {
        diaSemana: f.diaSemana,
        desde: hhmmToTimeDate(f.desde),
        hasta: hhmmToTimeDate(f.hasta),
      } as any,
    })),
  ])

  await escribirAudit(db, {
    accion: 'cliente_actualizado',
    entidad: 'cuenta',
    entidadId: cuenta.id,
    usuarioId: s.user.id,
    payload: { subaccion: 'horarios_actualizados', totalFranjas: parsed.data.franjas.length },
  })

  revalidatePath(`/${cuenta.slug}/config`)
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────
// EXCEPCIONES
// ─────────────────────────────────────────────────────────────

const CrearExcepcionSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'formato YYYY-MM-DD'),
  tipo: z.enum(['cerrado', 'horario_especial']),
  desde: z.string().regex(/^\d{2}:\d{2}$/, 'formato HH:MM').optional(),
  hasta: z.string().regex(/^\d{2}:\d{2}$/, 'formato HH:MM').optional(),
  motivo: z.string().max(200).optional(),
})

export async function crearExcepcion(input: unknown): Promise<AccionResult> {
  const parsed = CrearExcepcionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' }
  const guard = await guardOwner()
  if (!guard.ok) return guard
  const { db, cuenta, s } = guard
  const { fecha, tipo, desde, hasta, motivo } = parsed.data

  if (tipo === 'horario_especial' && (!desde || !hasta)) {
    return { ok: false, error: 'Horario especial requiere "desde" y "hasta"' }
  }
  if (tipo === 'horario_especial' && desde && hasta && desde >= hasta) {
    return { ok: false, error: '"desde" debe ser anterior a "hasta"' }
  }

  const [y, m, d] = fecha.split('-').map(Number)
  const fechaDate = new Date(Date.UTC(y, m - 1, d))

  try {
    await db.excepcionHorario.create({
      data: {
        fecha: fechaDate,
        tipo,
        motivo: motivo ?? '',
        desde: desde ? hhmmToTimeDate(desde) : null,
        hasta: hasta ? hhmmToTimeDate(hasta) : null,
      } as any,
    })
  } catch (err) {
    if (err instanceof Error && err.message.includes('Unique constraint')) {
      return { ok: false, error: 'Ya existe una excepción para esa fecha' }
    }
    throw err
  }

  await escribirAudit(db, {
    accion: 'cliente_creado',
    entidad: 'cuenta',
    entidadId: cuenta.id,
    usuarioId: s.user.id,
    payload: { subaccion: 'excepcion_creada', fecha, tipo, motivo },
  })

  revalidatePath(`/${cuenta.slug}/config`)
  return { ok: true }
}

const BorrarExcepcionSchema = z.object({ id: z.string().uuid() })

export async function borrarExcepcion(input: unknown): Promise<AccionResult> {
  const parsed = BorrarExcepcionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' }
  const guard = await guardOwner()
  if (!guard.ok) return guard
  const { db, cuenta, s } = guard

  await db.excepcionHorario.delete({ where: { id: parsed.data.id } })

  await escribirAudit(db, {
    accion: 'cliente_actualizado',
    entidad: 'cuenta',
    entidadId: cuenta.id,
    usuarioId: s.user.id,
    payload: { subaccion: 'excepcion_borrada', excepcionId: parsed.data.id },
  })

  revalidatePath(`/${cuenta.slug}/config`)
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────
// INFO DE CUENTA
// ─────────────────────────────────────────────────────────────

const ActualizarCuentaSchema = z.object({
  nombrePublico: z.string().min(1).max(120).optional(),
  telefonoWhatsapp: z.string().min(1).max(30).optional().or(z.literal('')),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'formato #RRGGBB').optional(),
  ubicacion: z.string().max(200).optional().or(z.literal('')),
})

export async function actualizarCuenta(input: unknown): Promise<AccionResult> {
  const parsed = ActualizarCuentaSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' }
  const guard = await guardOwner()
  if (!guard.ok) return guard
  const { db, cuenta, s } = guard

  const data: {
    nombrePublico?: string
    telefonoWhatsapp?: string | null
    color?: string
    ubicacion?: string | null
  } = {}
  if (parsed.data.nombrePublico !== undefined) data.nombrePublico = parsed.data.nombrePublico.trim()
  if (parsed.data.color !== undefined) data.color = parsed.data.color
  if (parsed.data.ubicacion !== undefined) data.ubicacion = parsed.data.ubicacion.trim() || null
  if (parsed.data.telefonoWhatsapp !== undefined) {
    if (parsed.data.telefonoWhatsapp === '') {
      data.telefonoWhatsapp = null
    } else {
      const normalizado = normalizarTelefonoE164(parsed.data.telefonoWhatsapp)
      if (!normalizado) return { ok: false, error: 'Teléfono WhatsApp inválido' }
      data.telefonoWhatsapp = normalizado
    }
  }

  await db.cuenta.update({ where: { id: cuenta.id }, data })

  await escribirAudit(db, {
    accion: 'cliente_actualizado',
    entidad: 'cuenta',
    entidadId: cuenta.id,
    usuarioId: s.user.id,
    payload: { subaccion: 'cuenta_actualizada', cambios: data },
  })

  revalidatePath(`/${cuenta.slug}/config`)
  return { ok: true }
}
