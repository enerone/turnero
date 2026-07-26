import type { TenantClient } from '@/lib/db/tenant-client'
import type { Cliente, Turno } from '@prisma/client'

export interface CrearClienteYTurnoInput {
  cliente: {
    nombre: string
    telefono: string
    email?: string
    notas?: string
  }
  turno: {
    servicioId: string
    inicio: Date
    fin: Date
    notas?: string
  }
}

export interface CrearClienteYTurnoOutput {
  cliente: Cliente
  turno: Turno
}

/**
 * Crea un cliente y un turno en dos llamadas separadas.
 * Necesario porque la extensión tenant-client NO inyecta cuentaId en nested writes.
 *
 * Uso:
 *   const { cliente, turno } = await crearClienteYTurno(db, input)
 */
export async function crearClienteYTurno(
  db: TenantClient,
  input: CrearClienteYTurnoInput,
): Promise<CrearClienteYTurnoOutput> {
  const cliente = await db.cliente.create({
    data: {
      nombre: input.cliente.nombre,
      telefono: input.cliente.telefono,
      email: input.cliente.email,
      notas: input.cliente.notas ?? '',
    } as any,
  })

  const turno = await db.turno.create({
    data: {
      clienteId: cliente.id,
      servicioId: input.turno.servicioId,
      inicio: input.turno.inicio,
      fin: input.turno.fin,
      notas: input.turno.notas ?? '',
    } as any,
  })

  return { cliente, turno }
}

/**
 * Busca o crea cliente por teléfono y crea turno.
 * Útil para reserva pública donde el cliente puede ser nuevo o existente.
 */
export async function obtenerOCrearClienteYTurno(
  db: TenantClient,
  input: {
    cliente: {
      nombre: string
      telefono: string
      email?: string
      notas?: string
    }
    turno: {
      servicioId: string
      inicio: Date
      fin: Date
      notas?: string
    }
  },
): Promise<CrearClienteYTurnoOutput> {
  let cliente = await db.cliente.findFirst({
    where: { telefono: input.cliente.telefono } as any,
  })

  if (!cliente) {
    cliente = await db.cliente.create({
      data: {
        nombre: input.cliente.nombre,
        telefono: input.cliente.telefono,
        email: input.cliente.email,
        notas: input.cliente.notas ?? '',
      } as any,
    })
  }

  const turno = await db.turno.create({
    data: {
      clienteId: cliente.id,
      servicioId: input.turno.servicioId,
      inicio: input.turno.inicio,
      fin: input.turno.fin,
      notas: input.turno.notas ?? '',
    } as any,
  })

  return { cliente, turno }
}