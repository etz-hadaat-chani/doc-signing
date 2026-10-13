-- Israeli ID: exactly 9 digits, padded with leading zeros (PRD section 12).
-- Not expressible in schema.prisma, so it lives only here.
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_id_number_check" CHECK ("id_number" ~ '^[0-9]{9}$');
