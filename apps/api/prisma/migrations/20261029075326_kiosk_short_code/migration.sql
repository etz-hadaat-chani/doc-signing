-- Office signing station on a separate computer (task 5.7 part B): a short code typed there
-- (only its SHA-256 stored, traded once for the long kiosk code), and the kiosk session's own
-- ID attempts on a row locked for good (decision D2). Adds only.

-- AlterTable
ALTER TABLE "kiosk_sessions" ADD COLUMN     "failed_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "own_attempts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "short_code_hash" CHAR(64),
ADD COLUMN     "short_code_used_at" TIMESTAMPTZ(3);

-- CHECK constraints and the partial index. Not expressible in schema.prisma, so they live only here.
ALTER TABLE "kiosk_sessions"
  ADD CONSTRAINT "kiosk_sessions_short_code_hash_check"
    CHECK ("short_code_hash" IS NULL OR "short_code_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "kiosk_sessions_short_code_used_check"
    CHECK ("short_code_used_at" IS NULL OR "short_code_hash" IS NOT NULL),
  ADD CONSTRAINT "kiosk_sessions_failed_attempts_check"
    CHECK ("failed_attempts" BETWEEN 0 AND 5);

-- A short code still waiting to be typed is unique (it is looked up by its hash alone). A clash
-- with another waiting code fails the insert, and the open tries a new code.
CREATE UNIQUE INDEX "kiosk_sessions_short_code_waiting_idx" ON "kiosk_sessions"("short_code_hash")
  WHERE "short_code_used_at" IS NULL AND "ended_at" IS NULL;
