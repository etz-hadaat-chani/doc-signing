import type { PageQuery } from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';

/** The user fields the API may return. Never `passwordHash`. */
export const staffUserSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;
export type StaffUserRow = Prisma.UserGetPayload<{ select: typeof staffUserSelect }>;

/** Staff-user queries that count, page or lock (layering rule). */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One page by name, then id (stable when two users share a name), and the total. */
  async list({ page, pageSize }: PageQuery): Promise<{ rows: StaffUserRow[]; total: number }> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        select: staffUserSelect,
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count(),
    ]);
    return { rows, total };
  }

  /**
   * Locks every active manager's row (FOR UPDATE, in id order) and returns their ids. Every user
   * change takes this lock first and the target user's second (lockUser), always in that order,
   * so two changes can't deadlock, and the "at least one active manager" check sees the
   * committed result of a change that ran at the same time.
   */
  async lockActiveManagers(db: Db): Promise<string[]> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE role = 'manager' AND is_active ORDER BY id FOR UPDATE`;
    return rows.map(({ id }) => id);
  }

  /** Locks one user's row (FOR UPDATE) and reads it; null when there is no such user. */
  async lockUser(id: string, db: Db): Promise<StaffUserRow | null> {
    await db.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
    return db.user.findUnique({ where: { id }, select: staffUserSelect });
  }
}
