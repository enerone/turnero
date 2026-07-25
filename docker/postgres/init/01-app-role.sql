-- Crea rol turnero_app: NOSUPERUSER NOBYPASSRLS.
-- La app usa este rol vía DATABASE_URL para que RLS aplique.
-- El rol turnero (owner, superuser) queda para migraciones y setup de tests (DIRECT_URL).

CREATE ROLE turnero_app LOGIN PASSWORD 'turnero_app' NOSUPERUSER NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO turnero_app;

-- Privileges sobre tablas y sequences ya existentes (por si el script corre luego de migrar).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO turnero_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO turnero_app;

-- Default privileges: objetos futuros creados por turnero (via prisma migrate)
-- también quedan accesibles para turnero_app.
ALTER DEFAULT PRIVILEGES FOR ROLE turnero IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO turnero_app;
ALTER DEFAULT PRIVILEGES FOR ROLE turnero IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO turnero_app;
