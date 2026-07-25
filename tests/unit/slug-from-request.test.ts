import { describe, expect, it } from 'vitest'
import { slugDesdeRequest } from '@/lib/tenant/slug-from-request'

const dominioBase = 'turnero.app'

describe('slugDesdeRequest', () => {
  it('extrae slug de subdominio', () => {
    expect(
      slugDesdeRequest({ hostname: 'escribania-doe.turnero.app', pathname: '/hoy' }, dominioBase),
    ).toEqual({ slug: 'escribania-doe', fuente: 'subdominio' })
  })

  it('extrae slug del path cuando el hostname es el dominio raíz', () => {
    expect(
      slugDesdeRequest({ hostname: 'turnero.app', pathname: '/escribania-doe/hoy' }, dominioBase),
    ).toEqual({ slug: 'escribania-doe', fuente: 'path' })
  })

  it('trata www como dominio raíz', () => {
    expect(
      slugDesdeRequest({ hostname: 'www.turnero.app', pathname: '/dra-ana' }, dominioBase),
    ).toEqual({ slug: 'dra-ana', fuente: 'path' })
  })

  it('trata localhost como dominio raíz', () => {
    expect(
      slugDesdeRequest({ hostname: 'localhost', pathname: '/dra-ana/hoy' }, dominioBase),
    ).toEqual({ slug: 'dra-ana', fuente: 'path' })
  })

  it('devuelve null si el primer segmento del path es reservado', () => {
    expect(
      slugDesdeRequest({ hostname: 'localhost', pathname: '/admin/x' }, dominioBase),
    ).toBeNull()
    expect(
      slugDesdeRequest({ hostname: 'localhost', pathname: '/api/webhook' }, dominioBase),
    ).toBeNull()
  })

  it('devuelve null si el subdominio es reservado', () => {
    expect(
      slugDesdeRequest({ hostname: 'admin.turnero.app', pathname: '/x' }, dominioBase),
    ).toBeNull()
  })

  it('devuelve null si el path es raíz o sin slug reconocible', () => {
    expect(slugDesdeRequest({ hostname: 'turnero.app', pathname: '/' }, dominioBase)).toBeNull()
    expect(slugDesdeRequest({ hostname: 'turnero.app', pathname: '' }, dominioBase)).toBeNull()
  })

  it('ignora puertos en el hostname', () => {
    expect(
      slugDesdeRequest({ hostname: 'localhost:3000', pathname: '/dra-ana' }, dominioBase),
    ).toEqual({ slug: 'dra-ana', fuente: 'path' })
  })
})
