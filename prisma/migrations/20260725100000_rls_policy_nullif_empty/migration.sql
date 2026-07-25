-- Ajuste de policies RLS: el GUC 'app.cuenta_id' seteado con SET LOCAL / set_config(..., TRUE)
-- no vuelve a NULL después de COMMIT en la misma sesión, sino que queda como '' (string vacío).
-- Como Prisma reutiliza conexiones del pool, current_setting(...) puede devolver '' en vez de NULL,
-- y ''::uuid tira "invalid input syntax for type uuid". Usamos NULLIF para tratar '' como NULL.

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
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (cuenta_id = NULLIF(current_setting(''app.cuenta_id'', true), '''')::uuid) '
      'WITH CHECK (cuenta_id = NULLIF(current_setting(''app.cuenta_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END $$;
