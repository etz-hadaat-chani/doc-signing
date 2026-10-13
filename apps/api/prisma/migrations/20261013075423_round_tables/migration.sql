-- CreateTable
CREATE TABLE "rounds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(150) NOT NULL,
    "mode" "round_mode" NOT NULL,
    "requires_signature" BOOLEAN NOT NULL DEFAULT true,
    "status" "round_status" NOT NULL DEFAULT 'draft',
    "reminders_enabled" BOOLEAN NOT NULL DEFAULT true,
    "reminder_interval_days" INTEGER NOT NULL DEFAULT 3,
    "max_reminders" INTEGER,
    "link_expires_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "round_id" UUID NOT NULL,
    "department_id" UUID,
    "template_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "round_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "round_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "template_id" UUID,
    "source_file_key" TEXT,
    "status" "assignment_status" NOT NULL DEFAULT 'pending',
    "failed_attempts" SMALLINT NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "first_opened_at" TIMESTAMPTZ(3),
    "last_reminder_at" TIMESTAMPTZ(3),
    "signed_at" TIMESTAMPTZ(3),
    "reminder_count" SMALLINT NOT NULL DEFAULT 0,
    "sign_method" "sign_method",
    "signed_file_key" TEXT,
    "signed_file_sha256" CHAR(64),
    "signer_ip" INET,
    "signer_user_agent" TEXT,
    "handled_by" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assignment_id" UUID NOT NULL,
    "type" "email_message_type" NOT NULL,
    "to_email" VARCHAR(255) NOT NULL,
    "token_hash" CHAR(64),
    "provider_message_id" VARCHAR(255),
    "status" "email_message_status" NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assignment_id" UUID NOT NULL,
    "template_field_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Edited by hand: NULLS NOT DISTINCT (PostgreSQL 15+) stops two NULL-department rows in one round.
-- schema.prisma declares the same index by name; Prisma doesn't compare this flag, so it keeps it.
CREATE UNIQUE INDEX "round_templates_round_id_department_id_key" ON "round_templates"("round_id", "department_id") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "assignments_round_id_employee_id_key" ON "assignments"("round_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_token_hash_key" ON "email_messages"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_responses_assignment_id_template_field_id_key" ON "assignment_responses"("assignment_id", "template_field_id");

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_templates" ADD CONSTRAINT "round_templates_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_templates" ADD CONSTRAINT "round_templates_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_templates" ADD CONSTRAINT "round_templates_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_responses" ADD CONSTRAINT "assignment_responses_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_responses" ADD CONSTRAINT "assignment_responses_template_field_id_fkey" FOREIGN KEY ("template_field_id") REFERENCES "template_fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints (PRD section 12). Not expressible in schema.prisma, so they live only here.
-- A CHECK only fails when it evaluates to FALSE, so NULL passes where a column is optional.
ALTER TABLE "rounds"
  ADD CONSTRAINT "rounds_reminder_interval_days_check" CHECK ("reminder_interval_days" > 0),
  ADD CONSTRAINT "rounds_max_reminders_check" CHECK ("max_reminders" > 0);

-- char(64) pads short values with spaces, so the regex also rejects values that are too short.
ALTER TABLE "assignments"
  ADD CONSTRAINT "assignments_failed_attempts_check" CHECK ("failed_attempts" BETWEEN 0 AND 5),
  ADD CONSTRAINT "assignments_reminder_count_check" CHECK ("reminder_count" >= 0),
  ADD CONSTRAINT "assignments_signed_file_sha256_check" CHECK ("signed_file_sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "assignments_document_check"
    CHECK ("template_id" IS NOT NULL OR "source_file_key" IS NOT NULL),
  ADD CONSTRAINT "assignments_signed_check"
    CHECK ("status" NOT IN ('signed', 'signed_manual')
           OR ("signed_at" IS NOT NULL AND "signed_file_key" IS NOT NULL));

-- Invite and reminder carry a link token; the signed copy never does.
ALTER TABLE "email_messages"
  ADD CONSTRAINT "email_messages_token_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "email_messages_token_hash_type_check"
    CHECK (("token_hash" IS NULL) = ("type" = 'signed_copy'));
