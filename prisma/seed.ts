import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_URL,
})

async function main() {
  const demo = await prisma.cuenta.upsert({
    where: { slug: 'demo' },
    create: {
      slug: 'demo',
      nombrePublico: 'Consultorio Demo',
      color: '#0ea5e9',
      ubicacion: 'Av. Corrientes 1234, CABA',
      telefonoWhatsapp: '+5491100000000',
    },
    update: {},
  })

  // Servicio default: idempotente vía id fijo
  const SERVICIO_DEMO_ID = '00000000-0000-0000-0000-000000000001'
  await prisma.servicio.upsert({
    where: { id: SERVICIO_DEMO_ID },
    create: {
      id: SERVICIO_DEMO_ID,
      cuentaId: demo.id,
      nombre: 'Consulta',
      duracionMinutos: 30,
      esDefault: true,
    },
    update: {},
  })

  console.log(`Seed OK. Cuenta demo: ${demo.slug}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
