import { KIOSK_CODE_MINUTES, type KioskEndReason } from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { LinkFacts } from './link-state.js';

/** A kiosk session with what the state of its assignment is worked out from. */
export interface KioskAccessRow extends LinkFacts {
  kioskSessionId: string;
  assignmentId: string;
  roundId: string;
  /** The manager who opened it: `handled_by` of a kiosk signature. */
  openedById: string;
  /** Not used, not ended and not past its time: the code still opens the ID check. */
  open: boolean;
}

/**
 * The office signing station's sessions (3.16, FR-MAN-4). The code is looked up only by its
 * SHA-256. Lock order, as everywhere: the round, then the assignment, then its kiosk rows.
 */
@Injectable()
export class KioskRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The kiosk session with this code hash, or null. */
  async findByCode(codeHash: string): Promise<KioskAccessRow | null> {
    return this.findWhere(Prisma.sql`ks.code_hash = ${codeHash}`);
  }

  /** The kiosk session a signing session belongs to (found by the cookie), or null. */
  async findById(kioskSessionId: string): Promise<KioskAccessRow | null> {
    return this.findWhere(Prisma.sql`ks.id = ${kioskSessionId}::uuid`);
  }

  private async findWhere(where: Prisma.Sql): Promise<KioskAccessRow | null> {
    const rows = await this.prisma.$queryRaw<KioskAccessRow[]>`
      SELECT ks.id AS "kioskSessionId", a.id AS "assignmentId", a.round_id AS "roundId",
             ks.opened_by AS "openedById",
             (ks.used_at IS NULL AND ks.ended_at IS NULL AND ks.expires_at > now()) AS open,
             a.status::text AS status, a.locked_at IS NOT NULL AS locked,
             r.status::text AS "roundStatus", r.link_expires_at AS "linkExpiresAt", now() AS now
      FROM kiosk_sessions ks
      JOIN assignments a ON a.id = ks.assignment_id
      JOIN rounds r ON r.id = a.round_id
      WHERE ${where}`;
    return rows[0] ?? null;
  }

  /**
   * Locks the kiosk row (the caller holds the round and assignment locks). `open`: its code
   * still opens the ID check; `going`: not ended (a signing session from it may still submit).
   */
  async lock(kioskSessionId: string, db: Db): Promise<{ open: boolean; going: boolean }> {
    const rows = await db.$queryRaw<{ open: boolean; going: boolean }[]>`
      SELECT (used_at IS NULL AND ended_at IS NULL AND expires_at > now()) AS open,
             ended_at IS NULL AS going
      FROM kiosk_sessions WHERE id = ${kioskSessionId}::uuid
      FOR UPDATE`;
    return rows[0] ?? { open: false, going: false };
  }

  /** The correct ID number used the code: it never opens anything again. */
  async markUsed(kioskSessionId: string, db: Db): Promise<void> {
    const changed = await db.kioskSession.updateMany({
      where: { id: kioskSessionId, usedAt: null, endedAt: null },
      data: { usedAt: new Date() },
    });
    if (changed.count !== 1) throw new Error('Kiosk session changed while verifying');
  }

  /** Ends one kiosk session (signed, or locked by the 5th wrong ID number). */
  async end(kioskSessionId: string, reason: KioskEndReason, db: Db): Promise<void> {
    await db.kioskSession.updateMany({
      where: { id: kioskSessionId, endedAt: null },
      data: { endedAt: new Date(), endReason: reason },
    });
  }

  /**
   * Ends every kiosk session of the assignment still going (a new one replaces them) and
   * deletes the signing sessions started from them. Returns how many were ended.
   */
  async endOpenOf(assignmentId: string, db: Db): Promise<number> {
    const going = await db.kioskSession.findMany({
      where: { assignmentId, endedAt: null },
      select: { id: true },
    });
    if (going.length === 0) return 0;
    const ids = going.map(({ id }) => id);
    await db.signingSession.deleteMany({ where: { kioskSessionId: { in: ids } } });
    await db.kioskSession.updateMany({
      where: { id: { in: ids }, endedAt: null },
      data: { endedAt: new Date(), endReason: 'replaced' },
    });
    return ids.length;
  }

  /** A new kiosk session; its code works for `KIOSK_CODE_MINUTES` on the database's clock. */
  async create(
    data: { assignmentId: string; codeHash: string; openedById: string },
    db: Db,
  ): Promise<{ id: string; expiresAt: Date }> {
    const rows = await db.$queryRaw<{ id: string; expiresAt: Date }[]>`
      INSERT INTO kiosk_sessions (assignment_id, code_hash, opened_by, expires_at)
      VALUES (${data.assignmentId}::uuid, ${data.codeHash}, ${data.openedById}::uuid,
              now() + make_interval(mins => ${KIOSK_CODE_MINUTES}))
      RETURNING id, expires_at AS "expiresAt"`;
    const [row] = rows;
    if (!row) throw new Error('Kiosk session not created');
    return row;
  }
}
