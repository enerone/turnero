import type { NextConfig } from 'next'

/**
 * Este proyecto tiene un caso poco común: `instrumentation.ts` arranca pg-boss
 * en el mismo proceso Node que Next.js. La cadena de transitive deps de
 * `googleapis` y `pg` incluye `agent-base`, `https-proxy-agent`, `pgpass`,
 * `split2` etc., que hacen `require('http')`, `require('stream')`, etc.
 *
 * `serverExternalPackages` sólo marca el top-level como external — webpack
 * sigue trazando los transitives. Y para instrumentation el target de webpack
 * es "node" pero por algún motivo no auto-externaliza los built-ins de Node.
 *
 * Fix: forzar built-ins de Node como externals commonjs en el bundle server.
 */
const NODE_BUILTINS = [
  'http', 'https', 'fs', 'fs/promises', 'stream', 'path', 'url', 'zlib',
  'crypto', 'util', 'net', 'tls', 'dns', 'os', 'child_process', 'events',
  'buffer', 'querystring', 'string_decoder', 'http2', 'process', 'assert',
  'module', 'worker_threads', 'perf_hooks',
  'util/types', 'timers/promises', 'fs/promises', 'stream/promises',
  'stream/web', 'dns/promises',
]

// CSP restrictivo: la app no ejecuta JS de terceros ni carga fuentes/imágenes
// externas (todavía). Si mañana metemos un pixel de analytics o embed, agregar
// los dominios acá y NO usar 'unsafe-inline' salvo que sea obligatorio.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // Next 15 inyecta inline scripts para hydration
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ')

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=(), payment=()' },
  // HSTS sólo tiene sentido cuando la app corre bajo HTTPS real.
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
]

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
  serverExternalPackages: [
    '@prisma/client',
    'pg-boss',
    'googleapis',
    'google-auth-library',
    'gaxios',
    'gcp-metadata',
    'gtoken',
    'https-proxy-agent',
    'agent-base',
    'googleapis-common',
    'pg',
    'pg-connection-string',
    'pg-pool',
    'pg-native',
    'pgpass',
    'split2',
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      const currentExternals = Array.isArray(config.externals) ? config.externals : []
      config.externals = [
        ...currentExternals,
        ...NODE_BUILTINS.map((name) => ({ [name]: `commonjs ${name}` })),
        // También matchear el prefijo `node:` (Node 16+ recommended form) —
        // webpack se traba con "Unhandled scheme" si no lo interceptamos.
        function nodeSchemeExternal(
          { request }: { request?: string },
          callback: (err?: unknown, result?: string) => void,
        ) {
          if (request && request.startsWith('node:')) {
            return callback(null, `commonjs ${request}`)
          }
          callback()
        },
      ]
    }
    return config
  },
}

export default nextConfig
