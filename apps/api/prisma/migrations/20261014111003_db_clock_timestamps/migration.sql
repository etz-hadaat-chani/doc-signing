-- One clock (task 3.4): created_at / updated_at of employees, departments and import batches
-- always come from the database clock, never from the app. Prisma fills in @updatedAt (and
-- sometimes created_at) from the app's clock; this trigger overwrites whatever was sent, and
-- created_at can't change after the insert. The import's stale check and its 24-hour preview
-- limit compare these columns with the database clock only.
--
-- created_at = now(), the start of the inserting transaction: a batch saved in the same
-- transaction as the preview's reads gets a time from before those reads.
-- updated_at = clock_timestamp(), the moment of the write itself (after any row-lock wait), so
-- an edit that lands after a preview has read the employee always looks newer than that preview.

CREATE FUNCTION "set_db_clock_timestamps"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."created_at" := now();
  ELSE
    NEW."created_at" := OLD."created_at";
  END IF;
  NEW."updated_at" := clock_timestamp();
  RETURN NEW;
END $$;

CREATE TRIGGER "employees_db_clock"
  BEFORE INSERT OR UPDATE ON "employees"
  FOR EACH ROW EXECUTE FUNCTION "set_db_clock_timestamps"();

CREATE TRIGGER "departments_db_clock"
  BEFORE INSERT OR UPDATE ON "departments"
  FOR EACH ROW EXECUTE FUNCTION "set_db_clock_timestamps"();

CREATE TRIGGER "import_batches_db_clock"
  BEFORE INSERT OR UPDATE ON "import_batches"
  FOR EACH ROW EXECUTE FUNCTION "set_db_clock_timestamps"();
