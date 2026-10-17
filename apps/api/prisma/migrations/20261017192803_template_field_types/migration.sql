-- Task 3.20: template field types and box settings (PRD FR-TPL-2, FR-TPL-4 to FR-TPL-10, §12).

-- CreateEnum
CREATE TYPE "template_fill_mode" AS ENUM ('system', 'employee', 'system_then_employee');

-- CreateEnum
CREATE TYPE "employer_signature_mode" AS ENUM ('pre_signed', 'after_employee', 'none');

-- New field types, added at the end (PostgreSQL 16 allows several in one migration). None of them
-- is used below: a value added in a transaction can't be used until it commits.
ALTER TYPE "template_field_type" ADD VALUE 'employee_number';
ALTER TYPE "template_field_type" ADD VALUE 'address';
ALTER TYPE "template_field_type" ADD VALUE 'landline';
ALTER TYPE "template_field_type" ADD VALUE 'mobile';
ALTER TYPE "template_field_type" ADD VALUE 'age';
ALTER TYPE "template_field_type" ADD VALUE 'job_title';
ALTER TYPE "template_field_type" ADD VALUE 'employment_status';
ALTER TYPE "template_field_type" ADD VALUE 'job_percent';
ALTER TYPE "template_field_type" ADD VALUE 'work_days';
ALTER TYPE "template_field_type" ADD VALUE 'study_fund';
ALTER TYPE "template_field_type" ADD VALUE 'pension_has_fund';
ALTER TYPE "template_field_type" ADD VALUE 'pension_no_fund';
ALTER TYPE "template_field_type" ADD VALUE 'pension_fund_name';
ALTER TYPE "template_field_type" ADD VALUE 'email_input';
ALTER TYPE "template_field_type" ADD VALUE 'no_email_checkbox';
ALTER TYPE "template_field_type" ADD VALUE 'long_text';
ALTER TYPE "template_field_type" ADD VALUE 'select';
ALTER TYPE "template_field_type" ADD VALUE 'date_input';
ALTER TYPE "template_field_type" ADD VALUE 'drawing';
ALTER TYPE "template_field_type" ADD VALUE 'employer_signature';

-- `key` is added empty, filled for the existing rows, then made NOT NULL.
ALTER TABLE "template_fields"
  ADD COLUMN "key" VARCHAR(50),
  ADD COLUMN "fill_mode" "template_fill_mode",
  ADD COLUMN "show_when" JSONB,
  ADD COLUMN "options" JSONB,
  ADD COLUMN "needs_approval" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "templates"
  ADD COLUMN "employer_signature_mode" "employer_signature_mode" NOT NULL DEFAULT 'none';

-- Existing positions keep their meaning: each gets its own type name as its key (all signature
-- positions are one box, `signature`). Name, ID and date are filled in by the system; signatures
-- have no fill mode. `checkbox` / `text` were refused by the API, so none should exist; if one
-- does, the employee fills it in.
UPDATE "template_fields" SET "key" = "field_type"::text;
UPDATE "template_fields" SET "fill_mode" = 'system'
  WHERE "field_type" IN ('full_name', 'id_number', 'date');
UPDATE "template_fields" SET "fill_mode" = 'employee'
  WHERE "field_type" IN ('checkbox', 'text');

ALTER TABLE "template_fields"
  ALTER COLUMN "key" SET NOT NULL,
  ADD CONSTRAINT "template_fields_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]*$');
