import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const IV_LEN = 12
const TAG_LEN = 16

/**
 * Cifra `plano` con AES-256-GCM. Devuelve un buffer con:
 * [ IV (12 bytes) || CIPHERTEXT || TAG (16 bytes) ]
 */
export async function cifrar(plano: string, llave: Uint8Array): Promise<Uint8Array> {
  if (llave.byteLength !== 32) throw new Error('AES-256-GCM requiere llave de 32 bytes')
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', llave, iv)
  const cipherText = Buffer.concat([cipher.update(plano, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, cipherText, tag])
}

/**
 * Descifra un buffer producido por `cifrar()`. Lanza si el tag no valida
 * (integridad + autenticación).
 */
export async function descifrar(cifrado: Uint8Array, llave: Uint8Array): Promise<string> {
  if (llave.byteLength !== 32) throw new Error('AES-256-GCM requiere llave de 32 bytes')
  const buf = Buffer.from(cifrado)
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('Cifrado inválido: demasiado corto')
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(buf.length - TAG_LEN)
  const cipherText = buf.subarray(IV_LEN, buf.length - TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', llave, iv)
  decipher.setAuthTag(tag)
  const plano = Buffer.concat([decipher.update(cipherText), decipher.final()])
  return plano.toString('utf-8')
}
