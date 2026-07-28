-- Quitamos el DROP DEFAULT del cuenta.id que Prisma genera espuriamente
-- (el default lo maneja la función SQL `crear_cuenta`).

CREATE TYPE "estado_outbox" AS ENUM ('pendiente', 'procesado', 'fallado');
CREATE TYPE "tipo_outbox_mensaje" AS ENUM ('email_transaccional', 'whatsapp');

CREATE TABLE "outbox_mensaje" (
    "id" UUID NOT NULL,
    "cuenta_id" UUID NOT NULL,
    "tipo" "tipo_outbox_mensaje" NOT NULL,
    "destinatario" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "estado" "estado_outbox" NOT NULL DEFAULT 'pendiente',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "siguiente_intento" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procesado_en" TIMESTAMPTZ(6),
    "ultimo_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outbox_mensaje_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "outbox_mensaje_estado_siguiente_intento_idx" ON "outbox_mensaje"("estado", "siguiente_intento");
CREATE INDEX "outbox_mensaje_cuenta_id_idx" ON "outbox_mensaje"("cuenta_id");

ALTER TABLE "outbox_mensaje" ADD CONSTRAINT "outbox_mensaje_cuenta_id_fkey"
  FOREIGN KEY ("cuenta_id") REFERENCES "cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: mismo patrón que el resto de tablas tenant-scoped.
ALTER TABLE "outbox_mensaje" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_mensaje" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "outbox_mensaje"
  USING (cuenta_id = NULLIF(current_setting('app.cuenta_id', true), '')::uuid)
  WITH CHECK (cuenta_id = NULLIF(current_setting('app.cuenta_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON "outbox_mensaje" TO turnero_app;
