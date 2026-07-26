-- Agregar DEFAULT gen_random_uuid() a cuenta.id
ALTER TABLE cuenta ALTER COLUMN id SET DEFAULT gen_random_uuid();