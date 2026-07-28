import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  crearServicio, actualizarServicio,
  reemplazarHorariosSemanales,
  crearExcepcion, borrarExcepcion,
  actualizarCuenta,
} from '@/app/[slug]/config/actions'
import { testPrisma, useTestDatabase } from './helpers/db'
import { crearCuentaFixture, crearServicioFixture } from './helpers/fixtures'

let currentSlug = ''
let currentUser: {
  id: string
  cuentaId: string
  rol: 'owner' | 'secretaria'
} | null = null

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (n: string) => (n === 'x-tenant-slug' ? currentSlug : null),
  }),
  cookies: async () => ({ get: () => null, set: () => {} }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/auth/session', () => ({
  getSession: async () => currentUser
    ? { session: { id: 'sess', userId: currentUser.id, expiresAt: new Date(Date.now() + 3600_000), fresh: false }, user: currentUser }
    : null,
}))

async function setupOwner() {
  const cuenta = await crearCuentaFixture(testPrisma)
  currentSlug = cuenta.slug
  const usuario = await testPrisma.usuario.create({
    data: {
      cuentaId: cuenta.id,
      email: 'owner@x.com',
      nombre: 'Owner',
      googleSub: `sub-${cuenta.id}`,
      rol: 'owner',
    },
  })
  currentUser = { id: usuario.id, cuentaId: cuenta.id, rol: 'owner' }
  return { cuenta, usuario }
}

describe('config actions — servicios', () => {
  useTestDatabase()
  beforeEach(() => { currentUser = null; currentSlug = '' })

  it('crearServicio funciona para owner y desmarca el default previo', async () => {
    const { cuenta } = await setupOwner()
    const svcExistente = await crearServicioFixture(testPrisma, cuenta.id, { esDefault: true })

    const res = await crearServicio({ nombre: 'Estudio', duracionMinutos: 60, esDefault: true })
    expect(res.ok).toBe(true)

    const servicios = await testPrisma.servicio.findMany({ where: { cuentaId: cuenta.id } })
    expect(servicios).toHaveLength(2)
    const nuevo = servicios.find((s) => s.nombre === 'Estudio')
    expect(nuevo?.esDefault).toBe(true)
    const previo = servicios.find((s) => s.id === svcExistente.id)
    expect(previo?.esDefault).toBe(false)
  })

  it('rechaza secretaria (no tiene editar_config)', async () => {
    const cuenta = await crearCuentaFixture(testPrisma)
    currentSlug = cuenta.slug
    const usuario = await testPrisma.usuario.create({
      data: {
        cuentaId: cuenta.id,
        email: 's@x.com',
        nombre: 'S',
        googleSub: `sub-${cuenta.id}`,
        rol: 'secretaria',
      },
    })
    currentUser = { id: usuario.id, cuentaId: cuenta.id, rol: 'secretaria' }

    const res = await crearServicio({ nombre: 'X', duracionMinutos: 30 })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/dueño|sólo/i)
  })

  it('actualizarServicio permite desactivar sin borrar', async () => {
    const { cuenta } = await setupOwner()
    const svc = await crearServicioFixture(testPrisma, cuenta.id)

    const res = await actualizarServicio({ id: svc.id, activo: false })
    expect(res.ok).toBe(true)
    const svcAct = await testPrisma.servicio.findUnique({ where: { id: svc.id } })
    expect(svcAct?.activo).toBe(false)
  })

  it('rechaza duración fuera de rango', async () => {
    await setupOwner()
    const res = await crearServicio({ nombre: 'X', duracionMinutos: 3 })
    expect(res.ok).toBe(false)
  })
})

describe('config actions — horarios semanales', () => {
  useTestDatabase()
  beforeEach(() => { currentUser = null; currentSlug = '' })

  it('reemplaza todos los horarios en una transacción', async () => {
    const { cuenta } = await setupOwner()
    // Franja preexistente
    await testPrisma.horarioSemanal.create({
      data: {
        cuentaId: cuenta.id, diaSemana: 1,
        desde: new Date(Date.UTC(1970, 0, 1, 8, 0)),
        hasta: new Date(Date.UTC(1970, 0, 1, 12, 0)),
      },
    })

    const res = await reemplazarHorariosSemanales({
      franjas: [
        { diaSemana: 1, desde: '09:00', hasta: '13:00' },
        { diaSemana: 1, desde: '15:00', hasta: '18:00' },
        { diaSemana: 2, desde: '10:00', hasta: '17:00' },
      ],
    })
    expect(res.ok).toBe(true)

    const horarios = await testPrisma.horarioSemanal.findMany({
      where: { cuentaId: cuenta.id }, orderBy: [{ diaSemana: 'asc' }, { desde: 'asc' }],
    })
    expect(horarios).toHaveLength(3)
    expect(horarios[0].desde.getUTCHours()).toBe(9)
    expect(horarios[1].desde.getUTCHours()).toBe(15)
    expect(horarios[2].diaSemana).toBe(2)
  })

  it('rechaza franjas donde desde >= hasta', async () => {
    await setupOwner()
    const res = await reemplazarHorariosSemanales({
      franjas: [{ diaSemana: 1, desde: '18:00', hasta: '09:00' }],
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/anterior/i)
  })

  it('permite semana vacía (todos los días cerrados)', async () => {
    const { cuenta } = await setupOwner()
    await testPrisma.horarioSemanal.create({
      data: {
        cuentaId: cuenta.id, diaSemana: 1,
        desde: new Date(Date.UTC(1970, 0, 1, 8, 0)),
        hasta: new Date(Date.UTC(1970, 0, 1, 12, 0)),
      },
    })

    const res = await reemplazarHorariosSemanales({ franjas: [] })
    expect(res.ok).toBe(true)
    const filas = await testPrisma.horarioSemanal.findMany({ where: { cuentaId: cuenta.id } })
    expect(filas).toHaveLength(0)
  })
})

describe('config actions — excepciones', () => {
  useTestDatabase()
  beforeEach(() => { currentUser = null; currentSlug = '' })

  it('crea excepción "cerrado" sin desde/hasta', async () => {
    const { cuenta } = await setupOwner()
    const res = await crearExcepcion({ fecha: '2028-12-25', tipo: 'cerrado', motivo: 'Navidad' })
    expect(res.ok).toBe(true)
    const exc = await testPrisma.excepcionHorario.findMany({ where: { cuentaId: cuenta.id } })
    expect(exc).toHaveLength(1)
    expect(exc[0].tipo).toBe('cerrado')
    expect(exc[0].motivo).toBe('Navidad')
  })

  it('rechaza horario_especial sin desde/hasta', async () => {
    await setupOwner()
    const res = await crearExcepcion({ fecha: '2028-06-01', tipo: 'horario_especial' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/requiere/i)
  })

  it('borra excepción', async () => {
    const { cuenta } = await setupOwner()
    const exc = await testPrisma.excepcionHorario.create({
      data: { cuentaId: cuenta.id, fecha: new Date('2028-12-25'), tipo: 'cerrado' },
    })

    const res = await borrarExcepcion({ id: exc.id })
    expect(res.ok).toBe(true)
    const post = await testPrisma.excepcionHorario.findMany()
    expect(post).toHaveLength(0)
  })
})

describe('config actions — cuenta', () => {
  useTestDatabase()
  beforeEach(() => { currentUser = null; currentSlug = '' })

  it('actualiza nombre público + normaliza telefono a E.164', async () => {
    const { cuenta } = await setupOwner()

    const res = await actualizarCuenta({
      nombrePublico: 'Consultorio Nuevo',
      telefonoWhatsapp: '011 4567 8900',
    })
    expect(res.ok).toBe(true)

    const actualizada = await testPrisma.cuenta.findUnique({ where: { id: cuenta.id } })
    expect(actualizada?.nombrePublico).toBe('Consultorio Nuevo')
    expect(actualizada?.telefonoWhatsapp).toBe('+541145678900')
  })

  it('permite vaciar el teléfono (string vacío → null)', async () => {
    const { cuenta } = await setupOwner()
    await testPrisma.cuenta.update({
      where: { id: cuenta.id },
      data: { telefonoWhatsapp: '+5491100000000' },
    })

    const res = await actualizarCuenta({ telefonoWhatsapp: '' })
    expect(res.ok).toBe(true)
    const post = await testPrisma.cuenta.findUnique({ where: { id: cuenta.id } })
    expect(post?.telefonoWhatsapp).toBeNull()
  })

  it('rechaza color con formato inválido', async () => {
    await setupOwner()
    const res = await actualizarCuenta({ color: 'blue' })
    expect(res.ok).toBe(false)
  })
})
