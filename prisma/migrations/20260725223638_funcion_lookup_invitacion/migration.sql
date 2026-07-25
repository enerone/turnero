-- Función SECURITY DEFINER para lookup de invitación por token, bypaseando RLS.
-- Necesaria porque el flow de aceptar-invitación no conoce el cuenta_id hasta
-- después del lookup.

CREATE OR REPLACE FUNCTION lookup_invitacion_por_token(p_token text)
RETURNS TABLE (
  id uuid,
  cuenta_id uuid,
  email text,
  expira_en timestamptz,
  aceptada_en timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, cuenta_id, email, expira_en, aceptada_en
  FROM invitacion
  WHERE token = p_token;
$$;

-- Permitir a turnero_app llamar la función
GRANT EXECUTE ON FUNCTION lookup_invitacion_por_token(text) TO turnero_app;
