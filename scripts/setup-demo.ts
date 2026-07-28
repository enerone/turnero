/**
 * Setea una cuenta demo para probar el sistema end-to-end sin OAuth real.
 * Idempotente: podés correrlo varias veces sin duplicar.
 *
 * Uso:
 *   npx tsx scripts/setup-demo.ts
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes } from 'node:crypto'

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
})

const SLUG = 'demo'
const EMAIL = 'demo@turnero.local'
const GOOGLE_SUB = 'demo-google-sub-fake'

async function main() {
  console.log('setup-demo: buscando cuenta existente…')
  let cuenta = await prisma.cuenta.findUnique({ where: { slug: SLUG } })

  if (!cuenta) {
    cuenta = await prisma.cuenta.create({
      data: {
        slug: SLUG,
        nombrePublico: 'Consultorio Demo',
        color: '#0ea5e9',
        ubicacion: 'Av. Corrientes 1234, CABA',
        telefonoWhatsapp: '+5491100000000',
      },
    })
    console.log(`  → cuenta creada: ${cuenta.id}`)
  } else {
    console.log(`  → cuenta ya existía: ${cuenta.id}`)
  }

  let usuario = await prisma.usuario.findUnique({ where: { googleSub: GOOGLE_SUB } })
  if (!usuario) {
    usuario = await prisma.usuario.create({
      data: {
        cuentaId: cuenta.id,
        email: EMAIL,
        nombre: 'Demo Owner',
        googleSub: GOOGLE_SUB,
        rol: 'owner',
      },
    })
    console.log(`  → usuario owner creado: ${usuario.id}`)
  } else {
    console.log(`  → usuario ya existía: ${usuario.id}`)
  }

  // IntegracionCalendar dummy — permite que el panel no se quede colgado en
  // "preparando calendario" y que el /hoy sea el default. calendarIdDedicado
  // apunta a un ID inventado; el sync a Google va a fallar pero eso lo esperamos
  // (no tenemos refresh_token real).
  const existe = await prisma.integracionCalendar.findUnique({ where: { cuentaId: cuenta.id } })
  if (!existe) {
    await prisma.integracionCalendar.create({
      data: {
        cuentaId: cuenta.id,
        refreshTokenCifrado: randomBytes(64), // buffer dummy
        calendarIdDedicado: 'demo-calendar-dummy',
        calendarIdPrimario: 'primary',
      },
    })
    console.log('  → integracion_calendar dummy creada')
  }

  // Servicios: uno default de 30 min si no hay ninguno
  const svcCount = await prisma.servicio.count({ where: { cuentaId: cuenta.id } })
  if (svcCount === 0) {
    await prisma.servicio.createMany({
      data: [
        { cuentaId: cuenta.id, nombre: 'Consulta', duracionMinutos: 30, esDefault: true, activo: true },
        { cuentaId: cuenta.id, nombre: 'Estudio largo', duracionMinutos: 60, esDefault: false, activo: true },
      ],
    })
    console.log('  → 2 servicios creados (Consulta 30min default, Estudio largo 60min)')
  }

  // Horarios: L-V 9-13 y 15-18 si no hay ninguno
  const horCount = await prisma.horarioSemanal.count({ where: { cuentaId: cuenta.id } })
  if (horCount === 0) {
    const dias = [1, 2, 3, 4, 5] // L-V
    const franjas = []
    for (const d of dias) {
      franjas.push({
        cuentaId: cuenta.id,
        diaSemana: d,
        desde: new Date(Date.UTC(1970, 0, 1, 9, 0)),
        hasta: new Date(Date.UTC(1970, 0, 1, 13, 0)),
      })
      franjas.push({
        cuentaId: cuenta.id,
        diaSemana: d,
        desde: new Date(Date.UTC(1970, 0, 1, 15, 0)),
        hasta: new Date(Date.UTC(1970, 0, 1, 18, 0)),
      })
    }
    await prisma.horarioSemanal.createMany({ data: franjas })
    console.log('  → horarios L-V 9-13 + 15-18 creados')
  }

  console.log('\n✅ Setup listo.\n')
  console.log('Datos para /test/login-as:')
  console.log(`  usuarioId: ${usuario.id}`)
  console.log(`  cuentaId:  ${cuenta.id}`)
  console.log('')
  console.log('URLs útiles (dev en http://localhost:3000):')
  console.log(`  Login test: /test/login-as?usuarioId=${usuario.id}&cuentaId=${cuenta.id}`)
  console.log(`  Panel hoy:  /${SLUG}/hoy`)
  console.log(`  Semana:     /${SLUG}/semana`)
  console.log(`  Config:     /${SLUG}/config`)
  console.log(`  Reserva:    /${SLUG}/reservar (público, sin login)`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
