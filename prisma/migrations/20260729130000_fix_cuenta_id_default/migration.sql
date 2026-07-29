-- Restaurar default gen_random_uuid() en cuenta.id
-- La migración conversacion_bot lo removió incorrectamente.
ALTER TABLE "cuenta" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
