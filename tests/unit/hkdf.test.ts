import { describe, expect, it } from 'vitest'
import { derivarLlavePorCuenta } from '@/lib/crypto/hkdf'

const MASTER = Buffer.from('a'.repeat(64), 'utf-8').subarray(0, 32)

describe('derivarLlavePorCuenta', () => {
  it('devuelve 32 bytes', async () => {
    const llave = await derivarLlavePorCuenta(MASTER, 'cuenta-123')
    expect(llave.byteLength).toBe(32)
  })

  it('es determinística para el mismo cuentaId', async () => {
    const a1 = await derivarLlavePorCuenta(MASTER, 'cuenta-abc')
    const a2 = await derivarLlavePorCuenta(MASTER, 'cuenta-abc')
    expect(Buffer.from(a1).equals(Buffer.from(a2))).toBe(true)
  })

  it('cuentas distintas producen llaves distintas', async () => {
    const a = await derivarLlavePorCuenta(MASTER, 'cuenta-abc')
    const b = await derivarLlavePorCuenta(MASTER, 'cuenta-xyz')
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })
})
