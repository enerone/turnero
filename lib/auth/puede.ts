export type Rol = 'owner' | 'secretaria'

export interface UsuarioAuth {
  rol: Rol
  cuentaId: string
}

export type Accion =
  | 'ver_turno'
  | 'crear_turno'
  | 'mover_turno'
  | 'cancelar_turno'
  | 'completar_turno'
  | 'ver_cliente'
  | 'crear_cliente'
  | 'editar_cliente'
  | 'editar_config'
  | 'invitar_usuario'
  | 'desconectar_calendar'
  | 'ver_audit_log'

const PERMISOS_SECRETARIA = new Set<Accion>([
  'ver_turno',
  'crear_turno',
  'mover_turno',
  'cancelar_turno',
  'completar_turno',
  'ver_cliente',
  'crear_cliente',
  'editar_cliente',
])

export function puede(usuario: UsuarioAuth, accion: Accion): boolean {
  if (usuario.rol === 'owner') return true
  if (usuario.rol === 'secretaria') return PERMISOS_SECRETARIA.has(accion)
  return false
}
