-- CreateEnum
CREATE TYPE "canal_bot" AS ENUM ('whatsapp', 'telegram');

-- CreateEnum
CREATE TYPE "estado_conversacion" AS ENUM ('inicio', 'esperando_dia', 'esperando_slot', 'esperando_nombre', 'completado', 'cancelado');

-- AlterTable
ALTER TABLE "cuenta" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "conversacion_bot" (
    "id" UUID NOT NULL,
    "cuenta_id" UUID NOT NULL,
    "canal" "canal_bot" NOT NULL,
    "externo_id" TEXT NOT NULL,
    "estado" "estado_conversacion" NOT NULL DEFAULT 'inicio',
    "contexto" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversacion_bot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversacion_bot_cuenta_id_idx" ON "conversacion_bot"("cuenta_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversacion_bot_cuenta_id_canal_externo_id_key" ON "conversacion_bot"("cuenta_id", "canal", "externo_id");

-- AddForeignKey
ALTER TABLE "conversacion_bot" ADD CONSTRAINT "conversacion_bot_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
