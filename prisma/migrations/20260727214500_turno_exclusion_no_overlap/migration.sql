-- Exclusion constraint para eliminar la race entre "chequear conflicto" y
-- "crear turno" en el circuito público de reservas. Sin esto, dos requests
-- concurrentes en el mismo slot pueden crear turnos superpuestos.
--
-- La constraint garantiza que NO existan dos filas del mismo (cuenta, servicio)
-- cuyos rangos [inicio, fin) se solapen, salvo que uno de los dos esté
-- cancelado / completado / no_asistio (los estados finales liberan el slot).
--
-- Requiere btree_gist para poder combinar UUID (=) con tstzrange (&&).

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "turno" ADD CONSTRAINT turno_no_overlap
  EXCLUDE USING gist (
    cuenta_id WITH =,
    servicio_id WITH =,
    tstzrange(inicio, fin, '[)') WITH &&
  )
  WHERE (estado IN ('confirmado', 'borrador'));
