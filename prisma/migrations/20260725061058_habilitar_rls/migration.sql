-- Habilitar Row-Level Security en todas las tablas tenant-scoped.
-- La policy lee app.cuenta_id (un runtime parameter que setea el tenant client).

-- El owner de las tablas (usuario turnero) BYPASSEA RLS por default.
-- Para que RLS aplique al mismo usuario que corre queries desde la app,
-- forzamos con FORCE ROW LEVEL SECURITY.

DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'usuario',
    'integracion_calendar',
    'servicio',
    'horario_semanal',
    'excepcion_horario',
    'cliente',
    'turno',
    'evento_externo',
    'audit_log',
    'invitacion'
  ];
BEGIN
  FOREACH t IN ARRAY tablas
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (cuenta_id = current_setting(''app.cuenta_id'', true)::uuid) '
      'WITH CHECK (cuenta_id = current_setting(''app.cuenta_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;
