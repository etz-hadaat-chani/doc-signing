-- Staff emails are stored lowercase (login lowercases before lookup). The API already
-- lowercases; this CHECK makes sure no other path stores capitals.

-- Stop, changing nothing, if two emails differ only by capitals: a person must decide which
-- account stays. (Checked in the dev and test databases on 2026-10-14: none.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users" GROUP BY lower("email") HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'users: emails that differ only by capitals exist; resolve them by hand first';
  END IF;
END $$;

-- No clashes, so lowercasing any remaining capitals is safe.
UPDATE "users" SET "email" = lower("email") WHERE "email" <> lower("email");

-- CHECK constraints. Not expressible in schema.prisma, so they live only here.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email"));
