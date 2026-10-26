import type { RoundMode, RoundSettings } from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import type { PlannedAssignment } from './round-plan.js';

/**
 * Key of the transaction-level advisory lock taken by every round creation (3.9; also the
 * correction round of 3.16), so two creations run one after the other and the second sees the
 * first one's assignments. Any fixed number works; this one is used for nothing else.
 */
export const ROUND_CREATE_LOCK = 3_009_001;

/** Assignments per insert: 1,500 employees → 2 queries, well under the parameter limit. */
const ASSIGNMENT_BATCH = 1000;

/** Writing rounds, their templates and assignments (3.9). Assignment status changes live here. */
@Injectable()
export class RoundsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Waits until no other round creation is running; held until the transaction ends. */
  async lockCreation(db: Db): Promise<void> {
    await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${ROUND_CREATE_LOCK}::bigint)`;
  }

  /** A new draft round. `link_expires_at` stays NULL until the send (3.10). */
  async createRound(
    data: {
      name: string;
      mode: RoundMode;
      settings: RoundSettings;
      createdById: string;
      /** A correction round (3.16): the returned assignment it replaces. */
      correctionOfAssignmentId?: string | null;
    },
    db: Db = this.prisma,
  ): Promise<{ id: string; createdAt: Date }> {
    const { settings } = data;
    return db.round.create({
      data: {
        name: data.name,
        mode: data.mode,
        status: 'draft',
        remindersEnabled: settings.remindersEnabled,
        reminderIntervalDays: settings.reminderIntervalDays,
        maxReminders: settings.maxReminders,
        linkExpiryDays: settings.linkExpiryDays,
        createdById: data.createdById,
        correctionOfAssignmentId: data.correctionOfAssignmentId ?? null,
      },
      select: { id: true, createdAt: true },
    });
  }

  async createRoundTemplates(
    roundId: string,
    rows: readonly { departmentId: string | null; templateId: string }[],
    db: Db = this.prisma,
  ): Promise<void> {
    await db.roundTemplate.createMany({ data: rows.map((row) => ({ roundId, ...row })) });
  }

  /** One assignment per planned row, in batches (never one query per employee). */
  async createAssignments(
    roundId: string,
    rows: readonly PlannedAssignment[],
    db: Db = this.prisma,
  ): Promise<number> {
    let created = 0;
    for (let start = 0; start < rows.length; start += ASSIGNMENT_BATCH) {
      const batch = rows.slice(start, start + ASSIGNMENT_BATCH);
      const result = await db.assignment.createMany({
        data: batch.map((row) => ({ roundId, ...row })),
      });
      created += result.count;
    }
    return created;
  }
}
