-- Función SECURITY DEFINER para crear cuenta bypassando RLS
-- Necesaria porque Prisma usa prepared statements que fallan con RLS en rol NOBYPASSRLS
DROP FUNCTION IF EXISTS crear_cuenta(text, text, text, text);

CREATE FUNCTION crear_cuenta(
  p_slug text,
  p_nombre_publico text,
  p_color text DEFAULT '#0ea5e9',
  p_timezone text DEFAULT 'America/Argentina/Buenos_Aires'
)
RETURNS SETOF cuenta
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $func$
  INSERT INTO cuenta (slug, nombre_publico, color, timezone, updated_at)
  VALUES (p_slug, p_nombre_publico, p_color, p_timezone, now())
  RETURNING *;
$func$;

GRANT EXECUTE ON FUNCTION crear_cuenta(text, text, text, text) TO turnero_app;