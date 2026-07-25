import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // pg-boss corre en el mismo proceso; asegurar que no se bundlee mal
  serverExternalPackages: ['@prisma/client'],
}

export default nextConfig
