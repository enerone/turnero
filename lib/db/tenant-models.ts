import type { Prisma } from '@prisma/client'

export const TENANT_SCOPED_MODELS = new Set<Prisma.ModelName>([
  'Usuario',
  'IntegracionCalendar',
  'Servicio',
  'HorarioSemanal',
  'ExcepcionHorario',
  'Cliente',
  'Turno',
  'EventoExterno',
  'AuditLog',
  'Invitacion',
  'TokenConfirmacion',
  'OutboxMensaje',
  'ConversacionBot',
])
