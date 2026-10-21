import {
  OPEN_ASSIGNMENT_STATUSES,
  type RoundRecipients,
  type RoundStatus,
  SIGNED_ASSIGNMENT_STATUSES,
  type SignMethod,
} from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { employeeDetailsSelect } from '../employees/employees.repository.js';

const recipientColumns = {
  id: true,
  employeeNumber: true,
  idNumber: true,
  firstName: true,
  lastName: true,
  departmentId: true,
  email: true,
  emailStatus: true,
  isActive: true,
  ...employeeDetailsSelect,
} satisfies Prisma.EmployeeSelect;
export type RecipientRow = Prisma.EmployeeGetPayload<{ select: typeof recipientColumns }>;

/** An earlier assignment of the same document (any version), with its round. */
export interface EarlierAssignment {
  employeeId: string;
  templateId: string;
  templateVersion: number;
  status: (typeof SIGNED_ASSIGNMENT_STATUSES)[number] | (typeof OPEN_ASSIGNMENT_STATUSES)[number];
  signedAt: Date | null;
  signMethod: SignMethod | null;
  roundId: string;
  roundName: string;
  roundStatus: RoundStatus;
  /** No expiry, or it is still ahead (the database clock). */
  linkValid: boolean;
}

/** Recipient-preview queries (3.8), also used by round creation (3.9): joins and big lists. */
@Injectable()
export class RoundRecipientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every employee the choice names (FR-RND-2), active or not, each once: all employees, or
   * those in the chosen departments or picked by hand. One query, whatever the number.
   */
  async findRecipients(recipients: RoundRecipients, db: Db = this.prisma): Promise<RecipientRow[]> {
    const where: Prisma.EmployeeWhereInput = recipients.all
      ? {}
      : {
          OR: [
            { departmentId: { in: recipients.departmentIds } },
            { id: { in: recipients.employeeIds } },
          ],
        };
    return db.employee.findMany({ where, select: recipientColumns, orderBy: { id: 'asc' } });
  }

  async findDepartments(
    ids: readonly string[],
    db: Db = this.prisma,
  ): Promise<{ id: string; code: number; name: string }[]> {
    if (ids.length === 0) return [];
    return db.department.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Signed or still open assignments of these employees for these template versions, in any
   * round, newest signature first. One query for the whole round.
   */
  async earlierAssignments(
    employeeIds: readonly string[],
    templateIds: readonly string[],
    db: Db = this.prisma,
  ): Promise<EarlierAssignment[]> {
    if (employeeIds.length === 0 || templateIds.length === 0) return [];
    const statuses = [...SIGNED_ASSIGNMENT_STATUSES, ...OPEN_ASSIGNMENT_STATUSES];
    const rows = await db.$queryRaw<
      (Omit<EarlierAssignment, 'status' | 'signMethod' | 'roundStatus'> & {
        status: string;
        signMethod: string | null;
        roundStatus: string;
      })[]
    >`
      SELECT a.employee_id AS "employeeId", a.template_id AS "templateId",
             t.version AS "templateVersion", a.status::text AS status,
             a.signed_at AS "signedAt", a.sign_method::text AS "signMethod",
             r.id AS "roundId", r.name AS "roundName", r.status::text AS "roundStatus",
             (r.link_expires_at IS NULL OR r.link_expires_at > now()) AS "linkValid"
      FROM assignments a
      JOIN rounds r ON r.id = a.round_id
      JOIN templates t ON t.id = a.template_id
      WHERE a.employee_id = ANY(${[...employeeIds]}::uuid[])
        AND a.template_id = ANY(${[...templateIds]}::uuid[])
        AND a.status::text = ANY(${statuses}::text[])
      ORDER BY a.signed_at DESC NULLS LAST, a.created_at DESC, a.id`;
    return rows as EarlierAssignment[];
  }
}
