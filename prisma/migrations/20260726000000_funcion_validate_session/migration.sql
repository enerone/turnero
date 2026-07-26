-- Función SECURITY DEFINER para validar una sesión y traer al usuario,
-- bypaseando RLS. Necesaria porque Lucia no conoce el cuenta_id
-- hasta después de resolver la sesión.

CREATE OR REPLACE FUNCTION lookup_session_con_usuario(p_session_id text)
RETURNS TABLE (
  session_id text,
  session_usuario_id uuid,
  session_expires_at timestamptz,
  usuario_id uuid,
  usuario_cuenta_id uuid,
  usuario_email text,
  usuario_nombre text,
  usuario_google_sub text,
  usuario_rol rol_usuario
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id, s.usuario_id, s.expires_at,
    u.id, u.cuenta_id, u.email, u.nombre, u.google_sub, u.rol
  FROM session s
  JOIN usuario u ON u.id = s.usuario_id
  WHERE s.id = p_session_id;
$$;

GRANT EXECUTE ON FUNCTION lookup_session_con_usuario(text) TO turnero_app;
