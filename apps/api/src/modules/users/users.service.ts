import type {
  CreateUserInput,
  PageQuery,
  Paged,
  StaffUser,
  UpdateUserInput,
} from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { Prisma } from '../../generated/prisma/client.js';
import { SessionService } from '../auth/session.service.js';
import { planUserChanges, type UserChange } from './user-changes.js';
import { staffUserSelect, type StaffUserRow, UsersRepository } from './users.repository.js';

/** The manager making a change: who, which session, from where. */
export interface UserActor {
  userId: string;
  sessionId: string;
  ip: string | null;
}

function toStaffUser(row: StaffUserRow): StaffUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    role: row.role,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function emailTaken(): AppException {
  return new AppException('EMAIL_TAKEN', HttpStatus.CONFLICT);
}

/** Staff users (FR-ADM-1): list, create, change. Manager only (the controller). */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: UsersRepository,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async list(query: PageQuery): Promise<Paged<StaffUser>> {
    const { rows, total } = await this.repository.list(query);
    return { items: rows.map(toStaffUser), total, ...query };
  }

  /** Creates a user and logs it together. The email arrives lowercased (createUserSchema). */
  async create(
    { email, fullName, role, password }: CreateUserInput,
    actor: UserActor,
  ): Promise<StaffUser> {
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw emailTaken();

    // Hashed before the transaction: Argon2 is slow on purpose. Same settings as login and seed.
    const passwordHash = await hash(password);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, fullName, role, passwordHash },
          select: staffUserSelect,
        });
        await this.audit.record(
          {
            actor: { type: 'user', userId: actor.userId },
            action: 'user.created',
            entity: { type: 'user', id: user.id },
            ip: actor.ip,
            details: { email, fullName, role },
          },
          tx,
        );
        return toStaffUser(user);
      });
    } catch (error) {
      // The same email created at the same moment by another request.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw emailTaken();
      }
      throw error;
    }
  }

  /**
   * Renames, changes role, disables/enables or resets the password, in one transaction with
   * one log row per real change. Locks the active managers, then the user (fixed order, see
   * UsersRepository); an actor who is no longer an active manager by then gets 403. Disabling or a reset ends the user's sessions; a manager resetting their
   * own password keeps the session they are using.
   */
  async update(id: string, input: UpdateUserInput, actor: UserActor): Promise<StaffUser> {
    const passwordHash = input.password === undefined ? undefined : await hash(input.password);

    return this.prisma.$transaction(async (tx) => {
      const activeManagerIds = await this.repository.lockActiveManagers(tx);
      // The guard checked the actor before the lock wait; a change that ran meanwhile may have
      // disabled or demoted them. Re-check under the lock, before anything changes.
      if (!activeManagerIds.includes(actor.userId)) {
        throw new AppException('FORBIDDEN', HttpStatus.FORBIDDEN);
      }
      const current = await this.repository.lockUser(id, tx);
      if (!current) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);

      const changes = planUserChanges(current, input, {
        actorId: actor.userId,
        activeManagerIds,
      });
      if (changes.length === 0) return toStaffUser(current);

      const updated = await tx.user.update({
        where: { id },
        data: {
          fullName: input.fullName,
          role: input.role,
          isActive: input.isActive,
          passwordHash,
        },
        select: staffUserSelect,
      });
      for (const change of changes) await this.applyAndLog(id, change, actor, tx);
      return toStaffUser(updated);
    });
  }

  /** Ends sessions where the change needs it, and writes the change's log row. */
  private async applyAndLog(
    userId: string,
    change: UserChange,
    actor: UserActor,
    tx: Db,
  ): Promise<void> {
    const base = {
      actor: { type: 'user', userId: actor.userId },
      entity: { type: 'user', id: userId },
      ip: actor.ip,
    } as const;

    switch (change.kind) {
      case 'renamed':
        return this.audit.record(
          { ...base, action: 'user.renamed', details: { from: change.from, to: change.to } },
          tx,
        );
      case 'role_changed':
        // No session delete needed: the session check reads the role fresh on every request.
        return this.audit.record(
          { ...base, action: 'user.role_changed', details: { from: change.from, to: change.to } },
          tx,
        );
      case 'disabled': {
        const sessionsEnded = await this.sessions.revokeAllForUser(userId, tx);
        return this.audit.record(
          { ...base, action: 'user.disabled', details: { sessionsEnded } },
          tx,
        );
      }
      case 'enabled':
        return this.audit.record({ ...base, action: 'user.enabled', details: {} }, tx);
      case 'password_reset': {
        const keep = userId === actor.userId ? actor.sessionId : undefined;
        const sessionsEnded = await this.sessions.revokeAllForUser(userId, tx, keep);
        return this.audit.record(
          { ...base, action: 'user.password_reset', details: { sessionsEnded } },
          tx,
        );
      }
    }
  }
}
