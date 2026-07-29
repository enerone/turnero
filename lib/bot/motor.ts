import { Prisma } from '@prisma/client'
import { basePrisma } from '@/lib/db/base-prisma'
import { createTenantClient } from '@/lib/db/tenant-client'
import { calcularDisponibilidad } from '@/lib/public-booking/disponibilidad'
import { formatearFechaLocal, formatearHoraLocal } from '@/lib/format/fecha'
import { logger } from '@/lib/shared/logger'
import {
  parsearDia,
  parsearOpcionNumerica,
  detectarCancelar,
  detectarSiguienteSemana,
} from './parser'

export interface Contexto {
  semanaOffset?: number
  diaElegido?: string
  slotsDisponibles?: Array<{ inicio: string; fin: string }>
  slotElegido?: { inicio: string; fin: string }
  nombre?: string
}

const DIAS_SEMANA_LABEL = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function weekdayEnTz(date: Date, tz: string): number {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(date)
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[s] ?? 0
}

function inicioSemana(fecha: Date, tz: string): Date {
  const wd = weekdayEnTz(fecha, tz)
  return new Date(fecha.getTime() - wd * 86_400_000)
}

async function obtenerServicioDefault(cuentaId: string) {
  const db = createTenantClient(cuentaId)
  const servicio = await db.servicio.findFirst({
    where: { activo: true },
    orderBy: [{ esDefault: 'desc' }, { createdAt: 'asc' }],
  })
  return servicio
}

async function crearTurnoBot(
  cuentaId: string,
  slot: { inicio: string; fin: string },
  nombre: string,
  externoId: string,
) {
  const db = createTenantClient(cuentaId)
  const servicio = await obtenerServicioDefault(cuentaId)
  if (!servicio) throw new Error('Sin servicio disponible')

  const inicioDt = new Date(slot.inicio)
  const finDt = new Date(slot.fin)
  const telefonoNorm = externoId.startsWith('+') ? externoId : `+${externoId}`

  // Upsert cliente por teléfono
  let cliente = await db.cliente.findFirst({ where: { telefono: telefonoNorm } })
  if (!cliente) {
    cliente = await db.cliente.create({
      data: { nombre, telefono: telefonoNorm } as any,
    })
  } else if (cliente.nombre !== nombre) {
    await db.cliente.update({ where: { id: cliente.id }, data: { nombre } })
  }

  const turno = await db.turno.create({
    data: {
      clienteId: cliente.id,
      servicioId: servicio.id,
      inicio: inicioDt,
      fin: finDt,
      estado: 'confirmado',
      origen: 'turnero',
    } as any,
  })

  return turno
}

/**
 * Motor principal de conversación. Procesa un mensaje del usuario, actualiza
 * la DB y devuelve el texto de respuesta a enviar.
 */
export async function procesarMensaje({
  cuentaId,
  canal,
  externoId,
  texto,
}: {
  cuentaId: string
  canal: 'whatsapp' | 'telegram'
  externoId: string
  texto: string
}): Promise<string> {
  const cuenta = await basePrisma.cuenta.findUnique({ where: { id: cuentaId } })
  if (!cuenta) return 'No encontramos esta cuenta. Escribinos para ayudarte.'

  const tz = cuenta.timezone

  // Cargar o crear conversación
  let conv = await basePrisma.conversacionBot.findUnique({
    where: { cuentaId_canal_externoId: { cuentaId, canal, externoId } },
  })
  if (!conv) {
    conv = await basePrisma.conversacionBot.create({
      data: { cuentaId, canal, externoId, estado: 'inicio', contexto: {} },
    })
  }

  const estado = conv.estado
  const ctx: Contexto = (conv.contexto as Contexto) ?? {}

  async function guardar(nuevoEstado: string, nuevoCtx: Contexto) {
    await basePrisma.conversacionBot.update({
      where: { id: conv!.id },
      data: { estado: nuevoEstado as any, contexto: nuevoCtx as any },
    })
  }

  // Cancelar en cualquier momento
  if (detectarCancelar(texto) && estado !== 'completado') {
    await guardar('cancelado', {})
    return 'Cancelado. Cuando quieras agendar un turno, escribime de nuevo.'
  }

  // Reiniciar desde cancelado o completado
  if (estado === 'cancelado' || estado === 'completado') {
    await guardar('esperando_dia', {})
    return saludoInicial(cuenta.nombrePublico)
  }

  if (estado === 'inicio' || estado === 'esperando_dia') {
    if (estado === 'inicio') {
      await guardar('esperando_dia', {})
      return saludoInicial(cuenta.nombrePublico)
    }

    // Ver si quiere siguiente semana mientras está eligiendo día
    if (detectarSiguienteSemana(texto)) {
      const offset = (ctx.semanaOffset ?? 0) + 1
      return await responderConSemana(cuentaId, cuenta.nombrePublico, tz, offset, ctx, conv.id, guardar)
    }

    const dia = parsearDia(texto, tz)
    if (!dia) {
      return 'No entendí la fecha. Podés escribir algo como "mañana", "el lunes" o "15/08".'
    }

    return await mostrarSlotsDia(cuentaId, cuenta.nombrePublico, tz, dia, ctx, conv.id, guardar)
  }

  if (estado === 'esperando_slot') {
    if (detectarSiguienteSemana(texto)) {
      const offset = (ctx.semanaOffset ?? 0) + 1
      return await responderConSemana(cuentaId, cuenta.nombrePublico, tz, offset, ctx, conv.id, guardar)
    }

    // Puede ser otro día
    const otroDia = parsearDia(texto, tz)
    if (otroDia) {
      return await mostrarSlotsDia(cuentaId, cuenta.nombrePublico, tz, otroDia, ctx, conv.id, guardar)
    }

    const slots = ctx.slotsDisponibles ?? []
    const idx = parsearOpcionNumerica(texto, slots.length)
    if (idx === null || !slots[idx]) {
      return `No entendí. Respondé con un número del 1 al ${slots.length}, o escribí otra fecha.`
    }

    const slot = slots[idx]
    const nuevoCTx: Contexto = { ...ctx, slotElegido: slot }
    await guardar('esperando_nombre', nuevoCTx)

    const inicioDate = new Date(slot.inicio)
    const label = `${formatearFechaLocal(inicioDate, tz)} a las ${formatearHoraLocal(inicioDate, tz)}`
    return `Perfecto, el ${label}. A nombre de quien agendamos?`
  }

  if (estado === 'esperando_nombre') {
    const nombre = texto.trim()
    if (nombre.length < 2) {
      return 'Necesito tu nombre completo para registrar el turno.'
    }
    if (!ctx.slotElegido) {
      await guardar('esperando_dia', {})
      return `Algo salió mal. Volvamos a empezar. ${saludoInicial(cuenta.nombrePublico)}`
    }

    try {
      const turno = await crearTurnoBot(cuentaId, ctx.slotElegido, nombre, externoId)
      const inicioDate = new Date(ctx.slotElegido.inicio)
      const label = `${formatearFechaLocal(inicioDate, tz)} a las ${formatearHoraLocal(inicioDate, tz)}`
      await guardar('completado', { ...ctx, nombre })
      logger.info({ turnoId: turno.id, cuentaId, canal }, 'Turno creado via bot')
      return `Listo! Tu turno quedó agendado para el ${label}. Te mandamos un recordatorio el día anterior.`
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError ||
        (err instanceof Error && /overlap|23P01/.test(err.message))
      ) {
        await guardar('esperando_dia', {})
        return 'Ese horario se ocupó justo ahora. Elegí otro día o contame cuándo podés.'
      }
      logger.error({ err, cuentaId, canal }, 'Error al crear turno via bot')
      return 'Tuve un problema para guardar el turno. Intentá de nuevo en unos minutos.'
    }
  }

  // Estado inesperado: reiniciar
  await guardar('esperando_dia', {})
  return saludoInicial(cuenta.nombrePublico)
}

function saludoInicial(nombrePublico: string): string {
  return `Hola! Para agendar tu turno con ${nombrePublico}, decime qué día preferís (ej: "mañana", "el lunes", "15/08").`
}

async function mostrarSlotsDia(
  cuentaId: string,
  nombrePublico: string,
  tz: string,
  dia: Date,
  ctx: Contexto,
  convId: string,
  guardar: (estado: string, ctx: Contexto) => Promise<void>,
): Promise<string> {
  const hasta = new Date(dia.getTime() + 86_400_000 - 1)
  const db = createTenantClient(cuentaId)
  const disponibilidad = await calcularDisponibilidad(db, { desde: dia, hasta, timezone: tz })

  const slotsDelDia = disponibilidad.flatMap((d) => d.slots)

  if (slotsDelDia.length === 0) {
    // Mostrar días disponibles en la semana actual
    const diasDisponibles = await obtenerDiasSemanaCon(cuentaId, dia, tz)
    const nuevoCTx: Contexto = { ...ctx, semanaOffset: 0 }
    await guardar('esperando_slot', nuevoCTx)

    let respuesta = `Ese día no tenemos lugar.`
    if (diasDisponibles.length > 0) {
      const listaLabel = diasDisponibles
        .map((d) => DIAS_SEMANA_LABEL[new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d) === 'Sun' ? 0 : weekdayEnTz(d, tz)])
        .join(', ')
      respuesta += ` Días disponibles esta semana: ${listaLabel}. Cual te queda mejor? O escribí "siguiente semana" para ver la próxima.`
    } else {
      respuesta += ` No hay turnos disponibles esta semana. Escribí "siguiente semana" para ver la próxima.`
    }
    return respuesta
  }

  const slotsSerializados = slotsDelDia.map((s) => ({
    inicio: s.inicio.toISOString(),
    fin: s.fin.toISOString(),
  }))

  const nuevoCTx: Contexto = {
    ...ctx,
    diaElegido: dia.toISOString(),
    slotsDisponibles: slotsSerializados,
  }
  await guardar('esperando_slot', nuevoCTx)

  const lista = slotsDelDia
    .map((s, i) => `${i + 1}. ${formatearHoraLocal(s.inicio, tz)}`)
    .join('\n')
  const diaLabel = formatearFechaLocal(dia, tz)
  return `Horarios disponibles el ${diaLabel}:\n${lista}\n\nCual preferís? Respondé con el número.`
}

async function obtenerDiasSemanaCon(cuentaId: string, referenceDia: Date, tz: string): Promise<Date[]> {
  const lunesSemana = inicioSemana(referenceDia, tz)
  const finde = new Date(lunesSemana.getTime() + 7 * 86_400_000 - 1)
  const db = createTenantClient(cuentaId)
  const disponibilidad = await calcularDisponibilidad(db, { desde: lunesSemana, hasta: finde, timezone: tz })
  return disponibilidad.filter((d) => d.slots.length > 0 && d.fecha > referenceDia).map((d) => d.fecha)
}

async function responderConSemana(
  cuentaId: string,
  nombrePublico: string,
  tz: string,
  semanaOffset: number,
  ctx: Contexto,
  convId: string,
  guardar: (estado: string, ctx: Contexto) => Promise<void>,
): Promise<string> {
  const ahora = new Date()
  const lunes = inicioSemana(ahora, tz)
  const lunesObjetivo = new Date(lunes.getTime() + semanaOffset * 7 * 86_400_000)
  const domingo = new Date(lunesObjetivo.getTime() + 7 * 86_400_000 - 1)

  const db = createTenantClient(cuentaId)
  const disponibilidad = await calcularDisponibilidad(db, {
    desde: lunesObjetivo,
    hasta: domingo,
    timezone: tz,
  })

  const diasCon = disponibilidad.filter((d) => d.slots.length > 0)
  const nuevoCTx: Contexto = { ...ctx, semanaOffset }
  await guardar('esperando_slot', nuevoCTx)

  if (diasCon.length === 0) {
    return `No hay turnos disponibles esa semana tampoco. Escribí "siguiente semana" para seguir buscando.`
  }

  const lista = diasCon
    .map((d) => {
      const wd = weekdayEnTz(d.fecha, tz)
      return `- ${DIAS_SEMANA_LABEL[wd]} ${formatearFechaLocal(d.fecha, tz)}`
    })
    .join('\n')
  return `Días disponibles esa semana:\n${lista}\n\nDecime cuál preferís.`
}
