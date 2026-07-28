-- Nota: quitamos el DROP DEFAULT del cuenta.id que Prisma genera espuriamente
-- (el default lo maneja la función SQL crear_cuenta).

ALTER TABLE "integracion_calendar"
  ADD COLUMN "watch_channel_dedicado_resource_id" TEXT,
  ADD COLUMN "watch_channel_dedicado_token" TEXT,
  ADD COLUMN "watch_channel_primario_resource_id" TEXT,
  ADD COLUMN "watch_channel_primario_token" TEXT,
  ALTER COLUMN "watch_channel_dedicado_expira" SET DATA TYPE TIMESTAMPTZ(6),
  ALTER COLUMN "watch_channel_primario_expira" SET DATA TYPE TIMESTAMPTZ(6);
