import { hkdf } from 'node:crypto'
import { promisify } from 'node:util'

const hkdfAsync = promisify(hkdf)

const INFO_PREFIX = 'turnero.cuenta.'

export async function derivarLlavePorCuenta(
  master: Buffer,
  cuentaId: string,
): Promise<ArrayBuffer> {
  const salt = Buffer.alloc(0)
  const info = Buffer.from(INFO_PREFIX + cuentaId, 'utf-8')
  return hkdfAsync('sha256', master, salt, info, 32)
}
