import { describe, expect, it } from 'vitest'
import { TENANT_SCOPED_MODELS } from '@/lib/db/tenant-models'

describe('TENANT_SCOPED_MODELS', () => {
  it('incluye todos los modelos con cuentaId excepto Cuenta', () => {
    const esperados = [
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
    ]
    for (const m of esperados) {
      expect(TENANT_SCOPED_MODELS.has(m as never)).toBe(true)
    }
  })

  it('no incluye Cuenta (el tenant es Cuenta misma)', () => {
    expect(TENANT_SCOPED_MODELS.has('Cuenta' as never)).toBe(false)
  })
})
