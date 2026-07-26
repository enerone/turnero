import { describe, expect, it } from 'vitest'
import { cifrar } from '@/lib/crypto/aes-gcm'
import { derivarLlavePorCuenta } from '@/lib/crypto/hkdf'
import { descifrarRefreshToken } from '@/lib/calendar/google-client'

describe('descifrarRefreshToken', () => {
  const MASTER = Buffer.from('a'.repeat(64), 'utf-8').subarray(0, 32)
  const CUENTA_ID = '00000000-0000-0000-0000-000000000001'

  it('descifra un refresh_token cifrado con la misma cuentaId', async () => {
    const llave = await derivarLlavePorCuenta(MASTER, CUENTA_ID)
    const cifrado = await cifrar('refresh-token-real', new Uint8Array(llave))
    const recuperado = await descifrarRefreshToken(
      Buffer.from(cifrado),
      CUENTA_ID,
      MASTER,
    )
    expect(recuperado).toBe('refresh-token-real')
  })

  it('falla con cuentaId distinta', async () => {
    const llave = await derivarLlavePorCuenta(MASTER, CUENTA_ID)
    const cifrado = await cifrar('token-x', new Uint8Array(llave))
    await expect(
      descifrarRefreshToken(Buffer.from(cifrado), 'otra-cuenta', MASTER),
    ).rejects.toThrow()
  })
})
