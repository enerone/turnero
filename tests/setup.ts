import { config } from 'dotenv'

// Vitest no auto-carga .env como sí hacen Next.js y Prisma. Los tests que
// importan @/lib/shared/env necesitan las vars presentes al momento en que
// zod valida el schema.
config()
