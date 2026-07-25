-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "usuario_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_usuario_id_idx" ON "session"("usuario_id");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
