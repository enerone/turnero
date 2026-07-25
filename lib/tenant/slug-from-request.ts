import { esReservado } from './reserved-slugs'
import { validarSlug } from './validate-slug'

export type SlugResuelto = { slug: string; fuente: 'subdominio' | 'path' }

export interface RequestInfo {
  hostname: string
  pathname: string
}

const HOSTS_RAIZ = new Set(['localhost', 'www'])

export function slugDesdeRequest(req: RequestInfo, dominioBase: string): SlugResuelto | null {
  const hostSinPuerto = req.hostname.split(':')[0].toLowerCase()

  // Subdominio
  if (hostSinPuerto.endsWith('.' + dominioBase)) {
    const sub = hostSinPuerto.slice(0, -('.' + dominioBase).length)
    if (sub === 'www' || sub === '') {
      // Cae a lógica de path
    } else if (esReservado(sub)) {
      return null
    } else if (validarSlug(sub).valido) {
      return { slug: sub, fuente: 'subdominio' }
    } else {
      return null
    }
  }

  // Dominio raíz o localhost → primer segmento del path
  const esDominioRaiz =
    hostSinPuerto === dominioBase ||
    hostSinPuerto === 'www.' + dominioBase ||
    HOSTS_RAIZ.has(hostSinPuerto)

  if (!esDominioRaiz) return null

  const segmentos = req.pathname.split('/').filter(Boolean)
  const primero = segmentos[0]
  if (!primero) return null
  if (esReservado(primero)) return null
  if (!validarSlug(primero).valido) return null
  return { slug: primero, fuente: 'path' }
}
