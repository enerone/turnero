import { describe, expect, it } from 'vitest'
import { cifrar, descifrar } from '@/lib/crypto/aes-gcm'

const LLAVE = new Uint8Array(32).fill(7)

describe('AES-256-GCM', () => {
  it('cifra y descifra un texto', async () => {
    const plano = 'refresh_token_de_ejemplo_muy_secreto'
    const cifrado = await cifrar(plano, LLAVE)
    const recuperado = await descifrar(cifrado, LLAVE)
    expect(recuperado).toBe(plano)
  })

  it('cada cifrado usa IV distinto (mismo texto → salida distinta)', async () => {
    const plano = 'texto-repetido'
    const a = await cifrar(plano, LLAVE)
    const b = await cifrar(plano, LLAVE)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it('descifrar con llave distinta falla', async () => {
    const plano = 'secreto'
    const cifrado = await cifrar(plano, LLAVE)
    const otra = new Uint8Array(32).fill(8)
    await expect(descifrar(cifrado, otra)).rejects.toThrow()
  })

  it('cifrado tamperado falla en descifrado (autenticación)', async () => {
    const plano = 'auth-check'
    const cifrado = await cifrar(plano, LLAVE)
    const tampered = new Uint8Array(cifrado)
    tampered[tampered.length - 1] ^= 0x01
    await expect(descifrar(tampered, LLAVE)).rejects.toThrow()
  })
})
