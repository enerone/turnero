-- Extendemos `lookup_integracion_calendar` para incluir campos de watch
-- channels + sync_token. DROP + CREATE porque cambia el shape del RETURNS.
--
-- Y agregamos `lookup_integracion_por_channel(channel_id)` para que el webhook
-- pueda resolver qué cuenta + qué calendario dispara el ping.

DROP FUNCTION IF EXISTS lookup_integracion_calendar(uuid);

CREATE FUNCTION lookup_integracion_calendar(p_cuenta_id uuid)
RETURNS TABLE (
  id uuid,
  cuenta_id uuid,
  refresh_token_cifrado bytea,
  calendar_id_dedicado text,
  calendar_id_primario text,
  estado estado_integracion,
  watch_channel_dedicado_id text,
  watch_channel_dedicado_resource_id text,
  watch_channel_dedicado_token text,
  watch_channel_dedicado_expira timestamptz,
  watch_channel_primario_id text,
  watch_channel_primario_resource_id text,
  watch_channel_primario_token text,
  watch_channel_primario_expira timestamptz,
  sync_token_dedicado text,
  sync_token_primario text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, cuenta_id, refresh_token_cifrado, calendar_id_dedicado,
         calendar_id_primario, estado,
         watch_channel_dedicado_id, watch_channel_dedicado_resource_id,
         watch_channel_dedicado_token, watch_channel_dedicado_expira,
         watch_channel_primario_id, watch_channel_primario_resource_id,
         watch_channel_primario_token, watch_channel_primario_expira,
         sync_token_dedicado, sync_token_primario
  FROM integracion_calendar
  WHERE cuenta_id = p_cuenta_id;
$$;

GRANT EXECUTE ON FUNCTION lookup_integracion_calendar(uuid) TO turnero_app;

-- Lookup por channel_id: el webhook de Google trae X-Goog-Channel-ID pero no
-- sabemos qué cuenta / qué calendario disparó el ping hasta que buscamos acá.
CREATE OR REPLACE FUNCTION lookup_integracion_por_channel(p_channel_id text)
RETURNS TABLE (
  cuenta_id uuid,
  tipo text, -- 'dedicado' o 'primario'
  calendar_id text,
  sync_token text,
  token text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cuenta_id,
         'dedicado'::text AS tipo,
         calendar_id_dedicado AS calendar_id,
         sync_token_dedicado AS sync_token,
         watch_channel_dedicado_token AS token
  FROM integracion_calendar
  WHERE watch_channel_dedicado_id = p_channel_id
  UNION ALL
  SELECT cuenta_id,
         'primario'::text AS tipo,
         calendar_id_primario AS calendar_id,
         sync_token_primario AS sync_token,
         watch_channel_primario_token AS token
  FROM integracion_calendar
  WHERE watch_channel_primario_id = p_channel_id;
$$;

GRANT EXECUTE ON FUNCTION lookup_integracion_por_channel(text) TO turnero_app;
