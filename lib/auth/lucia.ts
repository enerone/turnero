import { Lucia } from 'lucia'
import { PrismaAdapter } from '@lucia-auth/adapter-prisma'
import { basePrisma } from '@/lib/db/base-prisma'
import { env } from '@/lib/shared/env'

const adapter = new PrismaAdapter(basePrisma.session, basePrisma.usuario)

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    expires: false,
    attributes: {
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain:
        env.NODE_ENV === 'production'
          ? '.' + new URL(env.PUBLIC_BASE_URL).hostname
          : undefined,
    },
  },
  getUserAttributes: (usuario) => ({
    email: usuario.email,
    nombre: usuario.nombre,
    cuentaId: usuario.cuentaId,
    rol: usuario.rol,
    googleSub: usuario.googleSub,
  }),
})

declare module 'lucia' {
  interface Register {
    Lucia: typeof lucia
    DatabaseUserAttributes: {
      email: string
      nombre: string
      cuentaId: string
      rol: 'owner' | 'secretaria'
      googleSub: string
    }
  }
}
