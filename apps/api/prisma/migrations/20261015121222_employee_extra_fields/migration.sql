-- Task 3.19: extra employee data (PRD FR-EMP-1, FR-EMP-9, §12).

-- Two phones replace `phone`, plus the optional extra details. All NULL.
ALTER TABLE "employees"
  ADD COLUMN "landline" VARCHAR(20),
  ADD COLUMN "mobile" VARCHAR(20),
  ADD COLUMN "address" VARCHAR(150),
  ADD COLUMN "city" VARCHAR(60),
  ADD COLUMN "birth_date" DATE,
  ADD COLUMN "job_title" VARCHAR(100),
  ADD COLUMN "employment_status" VARCHAR(50),
  ADD COLUMN "job_percent" DECIMAL(5,2),
  ADD COLUMN "work_days" VARCHAR(50),
  ADD COLUMN "hours_base_code" SMALLINT,
  ADD COLUMN "pension_fund_a" VARCHAR(100),
  ADD COLUMN "pension_fund_b" VARCHAR(100),
  ADD COLUMN "study_fund" VARCHAR(100);

-- Every stored phone moves to exactly one of the two, unchanged: a mobile (05…) to `mobile`,
-- anything else (02-…, 077-…, or a value that is neither) to `landline`. Nothing is lost.
UPDATE "employees" SET "mobile" = "phone" WHERE "phone" LIKE '05%';
UPDATE "employees" SET "landline" = "phone" WHERE "phone" IS NOT NULL AND "phone" NOT LIKE '05%';

ALTER TABLE "employees" DROP COLUMN "phone";

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_job_percent_check" CHECK ("job_percent" BETWEEN 0 AND 100),
  ADD CONSTRAINT "employees_hours_base_code_check" CHECK ("hours_base_code" >= 0);

-- Import previews saved before this change were checked by the old reader: re-running them with
-- the new one could apply something other than what the preview showed. They are failed for good
-- (a confirm answers 409 IMPORT_ALREADY_DONE, "upload the file again"), each with its log row.
INSERT INTO "audit_log" ("actor_type", "action", "entity_type", "entity_id", "details")
SELECT 'system', 'import.failed', 'import_batch', "id",
       jsonb_build_object('fileName', "file_name", 'reason', 'format_changed')
FROM "import_batches" WHERE "status" = 'preview';

UPDATE "import_batches" SET "status" = 'failed' WHERE "status" = 'preview';
