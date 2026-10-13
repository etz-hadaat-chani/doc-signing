-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID,
    "actor_type" "actor_type" NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "details" JSONB NOT NULL DEFAULT '{}',
    "ip" INET,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "assignments_round_id_status_idx" ON "assignments"("round_id", "status");

-- CreateIndex
CREATE INDEX "assignments_employee_id_idx" ON "assignments"("employee_id");

-- CreateIndex
CREATE INDEX "assignments_status_last_reminder_at_idx" ON "assignments"("status", "last_reminder_at");

-- CreateIndex
CREATE INDEX "email_messages_assignment_id_idx" ON "email_messages"("assignment_id");

-- CreateIndex
CREATE INDEX "email_messages_provider_message_id_idx" ON "email_messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "employees_department_id_idx" ON "employees"("department_id");

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraint (PRD section 12). Not expressible in schema.prisma, so it lives only here.
-- Staff actions carry their user; employee and system actions have none.
ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_actor_user_check" CHECK (("actor_type" = 'user') = ("user_id" IS NOT NULL));

-- audit_log is append-only, even outside the app. Row triggers block UPDATE and DELETE; TRUNCATE
-- needs its own statement-level trigger. They also block TRUNCATE ... CASCADE from users.
-- Only the test reset bypasses them (session_replication_role = replica, test database only).
CREATE FUNCTION "audit_log_block_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER "audit_log_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_block_change"();

CREATE TRIGGER "audit_log_no_truncate"
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_block_change"();
