-- CreateTable
CREATE TABLE "cuenta" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "nombre_publico" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#0ea5e9',
    "ubicacion" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "telefono_whatsapp" TEXT,
    "subdominio_activo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cuenta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cuenta_slug_key" ON "cuenta"("slug");
