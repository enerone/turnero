export class NoTenantContextError extends Error {
  constructor(modelo: string, operacion: string) {
    super(
      `Intento de ${operacion} sobre ${modelo} sin cuentaId en el contexto. ` +
        `Toda query sobre modelos tenant-scoped debe hacerse con createTenantClient(cuentaId).`,
    )
    this.name = 'NoTenantContextError'
  }
}

export class TenantNotFoundError extends Error {
  constructor(slug: string) {
    super(`No existe una Cuenta con slug "${slug}".`)
    this.name = 'TenantNotFoundError'
  }
}

export class NoTenantInRequestError extends Error {
  constructor() {
    super('La request no tiene header x-tenant-slug. El middleware no resolvió tenant.')
    this.name = 'NoTenantInRequestError'
  }
}
