-- Departments are identified by their Har Gal code ("15 - name" in the export); the name can change.
-- Adding a NOT NULL column with no default is fine: there is no production data yet (pnpm db:reset).

-- DropIndex
DROP INDEX "departments_name_key";

-- AlterTable
ALTER TABLE "departments" ADD COLUMN "code" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- Not expressible in schema.prisma, so it lives only here.
ALTER TABLE "departments"
  ADD CONSTRAINT "departments_code_check" CHECK ("code" > 0);
