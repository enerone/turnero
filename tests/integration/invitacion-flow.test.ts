import { describe, expect, it } from 'vitest'
import { testPrisma, useTestDatabase } from './helpers/db'
import { crearCuentaFixture } from './helpers/fixtures'
import { crearInvitacion } from '@/lib/invitaciones/crear'
import { aceptarInvitacion } from '@/lib/invitaciones/aceptar'

describe('invitación de secretaria', () => {
  useTestDatabase()

  it('crear invitación devuelve token y expira en 7 días', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    const inv = await crearInvitacion(cuenta.id, 'secretaria@example.com')
    expect(inv.token).toHaveLength(43) // base64url de 32 bytes
    const diff = inv.expiraEn.getTime() - Date.now()
    expect(diff).toBeGreaterThan(6 * 24 * 60 * 60 * 1000)
    expect(diff).toBeLessThan(8 * 24 * 60 * 60 * 1000)
  })

  it('aceptar invitación válida crea Usuario secretaria', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    const inv = await crearInvitacion(cuenta.id, 'sec@example.com')
    const usuario = await aceptarInvitacion(inv.token, {
      googleSub: 'gs-secretaria',
      email: 'sec@example.com',
      nombre: 'Sec',
    })
    expect(usuario.rol).toBe('secretaria')
    expect(usuario.cuentaId).toBe(cuenta.id)

    const invUpdated = await testPrisma.invitacion.findUnique({ where: { id: inv.id } })
    expect(invUpdated?.aceptadaEn).not.toBeNull()
  })

  it('aceptar invitación ya usada falla', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    const inv = await crearInvitacion(cuenta.id, 'sec@example.com')
    await aceptarInvitacion(inv.token, { googleSub: 'gs1', email: 'sec@example.com', nombre: 'S' })
    await expect(
      aceptarInvitacion(inv.token, { googleSub: 'gs2', email: 'sec@example.com', nombre: 'S' }),
    ).rejects.toThrow(/ya (fue|aceptada)/i)
  })

  it('aceptar con token inválido falla', async () => {
    await expect(
      aceptarInvitacion('token-inexistente', { googleSub: 'x', email: 'x@x', nombre: 'X' }),
    ).rejects.toThrow(/no existe|inválid/i)
  })
})
