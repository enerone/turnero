import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // pg-boss + googleapis corren en el mismo proceso Node; evitar que Next
  // los bundlee (necesitan módulos Node como `http`, `pg-native`, `node:crypto`).
  serverExternalPackages: ['@prisma/client', 'pg-boss', 'googleapis', 'google-auth-library'],
}

export default nextConfig
