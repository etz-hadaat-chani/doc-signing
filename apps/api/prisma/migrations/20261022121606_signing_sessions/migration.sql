-- Employee signing (task 3.13): signing sessions (cookie token stored only as SHA-256, bound to
-- the assignment and the exact link used) and the per-IP counters of the public signing routes.

-- CreateTable
CREATE TABLE "signing_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" CHAR(64) NOT NULL,
    "assignment_id" UUID NOT NULL,
    "email_message_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signing_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signing_rate_hits" (
    "scope" VARCHAR(20) NOT NULL,
    "ip" INET NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "hits" INTEGER NOT NULL,

    CONSTRAINT "signing_rate_hits_pkey" PRIMARY KEY ("scope","ip","window_start")
);

-- CreateIndex
CREATE UNIQUE INDEX "signing_sessions_token_hash_key" ON "signing_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "signing_sessions_assignment_id_idx" ON "signing_sessions"("assignment_id");

-- CreateIndex
CREATE INDEX "signing_sessions_expires_at_idx" ON "signing_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "signing_rate_hits_window_start_idx" ON "signing_rate_hits"("window_start");

-- AddForeignKey
ALTER TABLE "signing_sessions" ADD CONSTRAINT "signing_sessions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signing_sessions" ADD CONSTRAINT "signing_sessions_email_message_id_fkey" FOREIGN KEY ("email_message_id") REFERENCES "email_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints and the partial index. Not expressible in schema.prisma, so they live only here.
ALTER TABLE "signing_sessions"
  ADD CONSTRAINT "signing_sessions_token_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "signing_rate_hits"
  ADD CONSTRAINT "signing_rate_hits_hits_check" CHECK ("hits" > 0),
  ADD CONSTRAINT "signing_rate_hits_scope_check" CHECK ("scope" ~ '^[a-z_]{1,20}$');

-- One signed copy per assignment (FR-SGN-6): two submits at once can never email it twice.
CREATE UNIQUE INDEX "email_messages_one_signed_copy_idx" ON "email_messages"("assignment_id")
  WHERE "type" = 'signed_copy';
