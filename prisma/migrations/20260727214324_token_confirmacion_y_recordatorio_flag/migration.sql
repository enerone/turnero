-- Nota: prisma migrate generó un `ALTER TABLE "cuenta" ALTER COLUMN "id" DROP DEFAULT`
-- que quitamos: el default está seteado por la función SQL `crear_cuenta`, no por Prisma.

-- AlterTable: flag de idempotencia para el job de recordatorios.
ALTER TABLE "turno" ADD COLUMN "recordatorio_enviado_en" TIMESTAMPTZ(6);

-- CreateTable: tokens de confirmación con hash + TTL + audit trail.
CREATE TABLE "token_confirmacion" (
    "id" UUID NOT NULL,
    "cuenta_id" UUID NOT NULL,
    "turno_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_en" TIMESTAMPTZ(6) NOT NULL,
    "usada_en" TIMESTAMPTZ(6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "token_confirmacion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "token_confirmacion_token_hash_key" ON "token_confirmacion"("token_hash");
CREATE INDEX "token_confirmacion_cuenta_id_turno_id_idx" ON "token_confirmacion"("cuenta_id", "turno_id");
CREATE INDEX "token_confirmacion_expira_en_idx" ON "token_confirmacion"("expira_en");

ALTER TABLE "token_confirmacion" ADD CONSTRAINT "token_confirmacion_cuenta_id_fkey"
  FOREIGN KEY ("cuenta_id") REFERENCES "cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "token_confirmacion" ADD CONSTRAINT "token_confirmacion_turno_id_fkey"
  FOREIGN KEY ("turno_id") REFERENCES "turno"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS con el mismo patrón que el resto de tablas tenant-scoped.
ALTER TABLE "token_confirmacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "token_confirmacion" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "token_confirmacion"
  USING (cuenta_id = NULLIF(current_setting('app.cuenta_id', true), '')::uuid)
  WITH CHECK (cuenta_id = NULLIF(current_setting('app.cuenta_id', true), '')::uuid);

-- Permisos para el rol de app (turnero_app), que es el que se usa en runtime.
GRANT SELECT, INSERT, UPDATE, DELETE ON "token_confirmacion" TO turnero_app;
