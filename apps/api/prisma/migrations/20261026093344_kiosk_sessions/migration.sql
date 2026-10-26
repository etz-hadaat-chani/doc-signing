-- Office signing station (task 3.16 part B): kiosk sessions opened by a manager (one-time code
-- stored only as SHA-256), and signing sessions that belong to a link OR a kiosk session.

-- CreateEnum
CREATE TYPE "kiosk_end_reason" AS ENUM ('replaced', 'signed', 'locked');

-- AlterTable
ALTER TABLE "signing_sessions" ADD COLUMN     "kiosk_session_id" UUID,
ALTER COLUMN "email_message_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "kiosk_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assignment_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "opened_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" "kiosk_end_reason",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kiosk_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_sessions_code_hash_key" ON "kiosk_sessions"("code_hash");

-- CreateIndex
CREATE INDEX "kiosk_sessions_assignment_id_idx" ON "kiosk_sessions"("assignment_id");

-- AddForeignKey
ALTER TABLE "signing_sessions" ADD CONSTRAINT "signing_sessions_kiosk_session_id_fkey" FOREIGN KEY ("kiosk_session_id") REFERENCES "kiosk_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_sessions" ADD CONSTRAINT "kiosk_sessions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_sessions" ADD CONSTRAINT "kiosk_sessions_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints and the partial index. Not expressible in schema.prisma, so they live only here.
ALTER TABLE "kiosk_sessions"
  ADD CONSTRAINT "kiosk_sessions_code_hash_check" CHECK ("code_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "kiosk_sessions_ended_check" CHECK (("ended_at" IS NULL) = ("end_reason" IS NULL));

-- A signing session opens exactly one thing: a link (email row) or a kiosk session.
ALTER TABLE "signing_sessions"
  ADD CONSTRAINT "signing_sessions_one_source_check"
    CHECK (num_nonnulls("email_message_id", "kiosk_session_id") = 1);

-- At most one kiosk session per assignment is still going: opening a new one ends the old first.
CREATE UNIQUE INDEX "kiosk_sessions_one_open_idx" ON "kiosk_sessions"("assignment_id")
  WHERE "ended_at" IS NULL;
