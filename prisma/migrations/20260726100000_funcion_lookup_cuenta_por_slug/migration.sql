-- Función SECURITY DEFINER para lookup de cuenta por slug, bypaseando RLS.
-- Necesaria porque getTenant() usa basePrisma (rol turnero_app con NOBYPASSRLS)
-- y no tenemos app.cuenta_id seteado hasta después de resolver el slug.

CREATE OR REPLACE FUNCTION lookup_cuenta_por_slug(p_slug text)
RETURNS TABLE (
  id uuid,
  slug text,
  nombre_publico text,
  color text,
  ubicacion text,
  timezone text,
  telefono_whatsapp text,
  subdominio_activo boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, slug, nombre_publico, color, ubicacion, timezone,
         telefono_whatsapp, subdominio_activo, created_at, updated_at
  FROM cuenta
  WHERE slug = p_slug;
$$;

-- Permitir a turnero_app llamar la función
GRANT EXECUTE ON FUNCTION lookup_cuenta_por_slug(text) TO turnero_app;