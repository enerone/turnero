export const RESERVED_SLUGS = new Set<string>([
  'admin',
  'api',
  'app',
  'www',
  'help',
  'soporte',
  'blog',
  'docs',
  'panel',
  'dashboard',
  'static',
  'assets',
  'favicon',
  'robots',
  'sitemap',
  'login',
  'logout',
  'signup',
  'cuenta',
  'cuentas',
  'settings',
  'auth',
  '_next',
  '_debug',
])

export function esReservado(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase())
}
