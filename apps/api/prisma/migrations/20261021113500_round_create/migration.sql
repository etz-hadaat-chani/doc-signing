-- Task 3.9: create a round (PRD FR-RND-1 to FR-RND-5, FR-RND-8, FR-TRK-6, §5, §12).
-- Only adds: no column is dropped, no stored value changes. Existing rows get NULL / false / 60.

-- Stop before any change if two answers of one assignment would share a key (the new unique
-- rule below). No code wrote this table before 3.13, so it is empty everywhere.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "assignment_responses" r
    JOIN "template_fields" f ON f."id" = r."template_field_id"
    GROUP BY r."assignment_id", f."key" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'assignment_responses has two answers with the same key in one assignment';
  END IF;
END $$;

-- New status, placed as in PRD §5. Not used below: a value added in a transaction can't be
-- used until it commits.
ALTER TYPE "assignment_status" ADD VALUE 'missing_data' BEFORE 'no_email';

-- Assignments: the values saved at send (3.10) and manager approval (FR-TRK-6).
ALTER TABLE "assignments"
  ADD COLUMN "field_values" JSONB,
  ADD COLUMN "needs_approval" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "approved_at" TIMESTAMPTZ(3),
  ADD COLUMN "approved_by" UUID,
  ADD COLUMN "returned_at" TIMESTAMPTZ(3),
  ADD COLUMN "returned_by" UUID,
  ADD COLUMN "return_note" VARCHAR(500);

ALTER TABLE "assignments"
  ADD CONSTRAINT "assignments_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "assignments_returned_by_fkey" FOREIGN KEY ("returned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints (PRD §12). Every existing row passes: all the new columns are NULL / false.
ALTER TABLE "assignments"
  ADD CONSTRAINT "assignments_approved_check"
    CHECK (("approved_at" IS NULL) = ("approved_by" IS NULL)
      AND ("approved_at" IS NULL OR "needs_approval")),
  ADD CONSTRAINT "assignments_returned_check"
    CHECK (("returned_at" IS NULL) = ("returned_by" IS NULL)
      AND ("returned_at" IS NULL) = ("return_note" IS NULL)
      AND ("returned_at" IS NULL OR "status" = 'cancelled'));

-- The approval list and count: signed, needs approval, not approved yet. Hand-written (Prisma
-- can't express a partial index).
CREATE INDEX "assignments_waiting_for_approval_idx" ON "assignments"("needs_approval", "approved_at")
  WHERE "status" = 'signed' AND "needs_approval" AND "approved_at" IS NULL;

-- Answers: one row per box key; drawings keep a file instead of a value (3.13).
DROP INDEX "assignment_responses_assignment_id_template_field_id_key";

ALTER TABLE "assignment_responses"
  ADD COLUMN "key" VARCHAR(50),
  ADD COLUMN "file_key" TEXT,
  ALTER COLUMN "template_field_id" DROP NOT NULL,
  ALTER COLUMN "value" DROP NOT NULL;

-- Existing rows (if any) take their position's key and keep their value.
UPDATE "assignment_responses" r SET "key" = f."key"
  FROM "template_fields" f WHERE f."id" = r."template_field_id";

ALTER TABLE "assignment_responses"
  ALTER COLUMN "key" SET NOT NULL,
  ADD CONSTRAINT "assignment_responses_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT "assignment_responses_value_or_file_check"
    CHECK (("value" IS NULL) <> ("file_key" IS NULL));

CREATE UNIQUE INDEX "assignment_responses_assignment_id_key_key" ON "assignment_responses"("assignment_id", "key");

-- Rounds: the link expiry in days until the send (3.10 sets link_expires_at), and the link of a
-- correction round to the assignment it replaces (one per assignment). Existing rounds get 60
-- (the built-in default) and keep their own link_expires_at; the default is then dropped, so the
-- app always sets the value.
ALTER TABLE "rounds"
  ADD COLUMN "link_expiry_days" SMALLINT NOT NULL DEFAULT 60,
  ADD COLUMN "correction_of_assignment_id" UUID;

ALTER TABLE "rounds"
  ALTER COLUMN "link_expiry_days" DROP DEFAULT,
  ADD CONSTRAINT "rounds_link_expiry_days_check" CHECK ("link_expiry_days" BETWEEN 1 AND 365),
  ADD CONSTRAINT "rounds_correction_of_assignment_id_fkey" FOREIGN KEY ("correction_of_assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "rounds_correction_of_assignment_id_key" ON "rounds"("correction_of_assignment_id");
