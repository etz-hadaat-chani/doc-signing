-- The employee's department when the round was created (a snapshot; the employee may move later).
-- Round filters, counts, signed file folders and ZIP folders use it, not employees.department_id.
-- NOT NULL with no default is fine: no assignments exist yet.

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "department_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "assignments_round_id_department_id_idx" ON "assignments"("round_id", "department_id");

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

