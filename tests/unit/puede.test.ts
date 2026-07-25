import { describe, expect, it } from 'vitest'
import { puede, type UsuarioAuth } from '@/lib/auth/puede'

const owner: UsuarioAuth = { rol: 'owner', cuentaId: 'c1' }
const secretaria: UsuarioAuth = { rol: 'secretaria', cuentaId: 'c1' }

describe('puede', () => {
  it('owner puede todo', () => {
    expect(puede(owner, 'ver_turno')).toBe(true)
    expect(puede(owner, 'crear_turno')).toBe(true)
    expect(puede(owner, 'editar_config')).toBe(true)
    expect(puede(owner, 'invitar_usuario')).toBe(true)
    expect(puede(owner, 'desconectar_calendar')).toBe(true)
  })

  it('secretaria puede operar la agenda pero no tocar config', () => {
    expect(puede(secretaria, 'ver_turno')).toBe(true)
    expect(puede(secretaria, 'crear_turno')).toBe(true)
    expect(puede(secretaria, 'mover_turno')).toBe(true)
    expect(puede(secretaria, 'cancelar_turno')).toBe(true)
    expect(puede(secretaria, 'ver_cliente')).toBe(true)
    expect(puede(secretaria, 'editar_config')).toBe(false)
    expect(puede(secretaria, 'invitar_usuario')).toBe(false)
    expect(puede(secretaria, 'desconectar_calendar')).toBe(false)
  })
})
