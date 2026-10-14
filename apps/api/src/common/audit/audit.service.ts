import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Db } from '../prisma/prisma.types.js';
import { assertSafeDetails, sanitizeDetails } from './audit-details.js';
import type { AuditAction, AuditDetailsMap, AuditEntityType } from './audit.actions.js';

/** Who did it. Only a staff user has a user id (the DB check `audit_log_actor_user_check`). */
export type AuditActor =
  { type: 'user'; userId: string } | { type: 'employee' } | { type: 'system' };

export interface AuditEntry<A extends AuditAction> {
  actor: AuditActor;
  action: A;
  entity: { type: AuditEntityType; id: string | null };
  ip: string | null;
  details: AuditDetailsMap[A];
}

/**
 * The activity log (append only). Adding a row is the only operation: there is no update or
 * delete here, and the database refuses both anyway. Pass the transaction's `tx` as `db` so the
 * change and its log row are saved together or not at all.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record<A extends AuditAction>(entry: AuditEntry<A>, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({ data: toRow(entry) });
  }

  /**
   * Many rows in one insert (e.g. one per employee an import changed), with the same checks as
   * `record`. Any unsafe entry fails the whole call before anything is written.
   */
  async recordMany<A extends AuditAction>(
    entries: readonly AuditEntry<A>[],
    db: Db = this.prisma,
  ): Promise<void> {
    if (entries.length === 0) return;
    await db.auditLog.createMany({ data: entries.map(toRow) });
  }
}

function toRow<A extends AuditAction>({ actor, action, entity, ip, details }: AuditEntry<A>) {
  assertSafeDetails(details);
  return {
    actorType: actor.type,
    userId: actor.type === 'user' ? actor.userId : null,
    action,
    entityType: entity.type,
    entityId: entity.id,
    ip,
    details: sanitizeDetails(details),
  };
}
