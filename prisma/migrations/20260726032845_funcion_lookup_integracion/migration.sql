-- Función SECURITY DEFINER para lookup de IntegracionCalendar por cuentaId
-- desde código que no tiene tenant context establecido (por ejemplo, jobs
-- que reciben cuentaId como payload).

CREATE OR REPLACE FUNCTION lookup_integracion_calendar(p_cuenta_id uuid)
RETURNS TABLE (
  id uuid,
  cuenta_id uuid,
  refresh_token_cifrado bytea,
  calendar_id_dedicado text,
  calendar_id_primario text,
  estado estado_integracion
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, cuenta_id, refresh_token_cifrado, calendar_id_dedicado,
         calendar_id_primario, estado
  FROM integracion_calendar
  WHERE cuenta_id = p_cuenta_id;
$$;

GRANT EXECUTE ON FUNCTION lookup_integracion_calendar(uuid) TO turnero_app;
