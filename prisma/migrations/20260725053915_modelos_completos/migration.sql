-- CreateEnum
CREATE TYPE "rol_usuario" AS ENUM ('owner', 'secretaria');

-- CreateEnum
CREATE TYPE "estado_integracion" AS ENUM ('conectado', 'desconectado');

-- CreateEnum
CREATE TYPE "tipo_excepcion" AS ENUM ('cerrado', 'horario_especial');

-- CreateEnum
CREATE TYPE "estado_turno" AS ENUM ('borrador', 'confirmado', 'cancelado', 'completado', 'no_asistio');

-- CreateEnum
CREATE TYPE "origen_turno" AS ENUM ('turnero', 'google_calendar');

-- CreateEnum
CREATE TYPE "origen_cancelacion" AS ENUM ('panel', 'google_calendar', 'cliente');

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL,
    "cuenta_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "google_sub" TEXT NOT NULL,
    "rol" "rol_usuario" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integracion_calendar" (
    "id" UUID NOT NULL,
    "cuenta_id" UUID NOT NULL,
    "refresh_token_cifrado" BYTEA NOT NULL,
    "calendar_id_dedicado" TEXT,
    "calendar_id_primario" TEXT NOT NULL DEFAULT 'primary',
    "watch_channel_dedicado_id" TEXT,
    "watch_channel_dedicado_expira" TIMESTAMP(3),
    "watch_channel_primario_id" TEXT,
    "watch_channel_primario_expira" TIMESTAMP(3),
    "sync_token_dedicado" TEXT,
    "sync_token_primario" TEXT,
    "estado" "estado_integracion" NOT NULL DEFAULT 'conectado',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integracion_calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicio" (
    "id" UUID NOT NULL,
    "cuenta_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "duracion_minutos" INTEGER NOT NULL,
    "es_default" BOOLEAN NOT NULL DEFAULT false,
    "permite_sobreturnos" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "horario_semanal" (
    "id" UUID NOT NULL,
    "cuenta_id" UUID NOT NULL,
    "dia_semana" INTEGER NOT NULL,
    "desde" TIME NOT NULL,
    "hasta" TIME NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "horario_semanal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "excepcion_horario" (
    "id" UUID NOT NULL,
    "cuenta_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "tipo" "tipo_excepcion" NOT NULL,
    "desde" TIME,
    "hasta" TIME,
    "motivo" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "excepcion_horario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliente" (
    "id" UUID NOT NULL,
    "cuenta_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "email" TEXT,
    "notas" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turno" (
    "id" UUID NOT NULL,
    "cuenta_id" UUID NOT NULL,
    "cliente_id" UUID,
    "servicio_id" UUID NOT NULL,
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "fin" TIMESTAMPTZ(6) NOT NULL,
    "estado" "estado_turno" NOT NULL DEFAULT 'confirmado',
    "google_event_id" TEXT,
    "google_event_etag" TEXT,
    "origen" "origen_turno" NOT NULL DEFAULT 'turnero',
    "origen_cancelacion" "origen_cancelacion",
    "notas" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "turno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_externo" (
    "id" UUID NOT NULL,
    "cuenta_id" UUID NOT NULL,
    "google_event_id" TEXT NOT NULL,
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "fin" TIMESTAMPTZ(6) NOT NULL,
    "titulo" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evento_externo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "cuenta_id" UUID NOT NULL,
    "usuario_id" UUID,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" UUID,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitacion" (
    "id" UUID NOT NULL,
    "cuenta_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "aceptada_en" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_google_sub_key" ON "usuario"("google_sub");

-- CreateIndex
CREATE INDEX "usuario_cuenta_id_idx" ON "usuario"("cuenta_id");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_cuenta_id_email_key" ON "usuario"("cuenta_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "integracion_calendar_cuenta_id_key" ON "integracion_calendar"("cuenta_id");

-- CreateIndex
CREATE INDEX "servicio_cuenta_id_idx" ON "servicio"("cuenta_id");

-- CreateIndex
CREATE INDEX "horario_semanal_cuenta_id_dia_semana_idx" ON "horario_semanal"("cuenta_id", "dia_semana");

-- CreateIndex
CREATE UNIQUE INDEX "excepcion_horario_cuenta_id_fecha_key" ON "excepcion_horario"("cuenta_id", "fecha");

-- CreateIndex
CREATE INDEX "cliente_cuenta_id_idx" ON "cliente"("cuenta_id");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_cuenta_id_telefono_key" ON "cliente"("cuenta_id", "telefono");

-- CreateIndex
CREATE INDEX "turno_cuenta_id_inicio_idx" ON "turno"("cuenta_id", "inicio");

-- CreateIndex
CREATE INDEX "turno_cuenta_id_google_event_id_idx" ON "turno"("cuenta_id", "google_event_id");

-- CreateIndex
CREATE INDEX "evento_externo_cuenta_id_inicio_idx" ON "evento_externo"("cuenta_id", "inicio");

-- CreateIndex
CREATE UNIQUE INDEX "evento_externo_cuenta_id_google_event_id_key" ON "evento_externo"("cuenta_id", "google_event_id");

-- CreateIndex
CREATE INDEX "audit_log_cuenta_id_created_at_idx" ON "audit_log"("cuenta_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "invitacion_token_key" ON "invitacion"("token");

-- CreateIndex
CREATE INDEX "invitacion_cuenta_id_idx" ON "invitacion"("cuenta_id");

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integracion_calendar" ADD CONSTRAINT "integracion_calendar_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicio" ADD CONSTRAINT "servicio_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horario_semanal" ADD CONSTRAINT "horario_semanal_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excepcion_horario" ADD CONSTRAINT "excepcion_horario_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turno" ADD CONSTRAINT "turno_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turno" ADD CONSTRAINT "turno_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turno" ADD CONSTRAINT "turno_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_externo" ADD CONSTRAINT "evento_externo_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitacion" ADD CONSTRAINT "invitacion_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
