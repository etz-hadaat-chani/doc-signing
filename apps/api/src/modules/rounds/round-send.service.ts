import {
  linkExpiresAtFrom,
  type RoundOutdatedTemplate,
  type RoundSendInput,
  type RoundSent,
  todayInIsrael,
} from '@doc-signing/shared';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { INVITATION_QUEUE } from '../../common/queue/queue.definitions.js';
import { QueueService } from '../../common/queue/queue.service.js';
import { SettingsService } from '../../common/settings/settings.service.js';
import { detailsFromRow } from '../employees/employees.repository.js';
import { PdfAssetsService } from '../pdf-filler/pdf-assets.service.js';
import type { TextFitCache } from '../pdf-filler/pdf-text.js';
import { toPosition } from '../templates/stored-position.js';
import { TemplatesRepository } from '../templates/templates.repository.js';
import { type TemplateActor, templateUsability } from '../templates/templates.service.js';
import type { RecipientEmployee } from './recipient-outcome.js';
import { planRoundSend } from './round-send-plan.js';
import { RoundSendRepository, type SendableRow } from './round-send.repository.js';
import { type CandidateTemplate, templateRef } from './round-templates.js';

/** Like round creation: READ COMMITTED; the round row lock makes two sends run in turn. */
const SEND_TRANSACTION = { maxWait: 10_000, timeout: 30_000 } as const;

/**
 * Sending a draft round (3.10, FR-RND-5, FR-RND-6, FR-RND-8): one transaction checks the round's
 * templates again, saves each document's values, sets the statuses and the link expiry, and
 * queues one invitation job per employee with an email (pg-boss `fromPrisma`, so the jobs commit
 * with everything else or not at all). The emails go out in the worker (`SigningEmailSender`).
 */
@Injectable()
export class RoundSendService {
  private readonly logger = new Logger(RoundSendService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: RoundSendRepository,
    private readonly templates: TemplatesRepository,
    private readonly settings: SettingsService,
    private readonly queue: QueueService,
    private readonly assets: PdfAssetsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The round row lock (a second click waits, then gets 409) → its assignments locked → their
   * templates locked and checked (ready: 409, no override; outdated: 409 unless confirmed) →
   * one clock (`now()`) for `sent_at` and `link_expires_at` → the plan (3.8 rule on today's
   * data) → the writes → the jobs → one audit row.
   */
  async send(roundId: string, input: RoundSendInput, actor: TemplateActor): Promise<RoundSent> {
    const sent = await this.prisma.$transaction(
      (tx) => this.sendInTransaction(roundId, input, actor, tx),
      SEND_TRANSACTION,
    );
    this.logger.log(`Round ${roundId}: queued ${String(sent.counts.queued)} invitations`);
    return sent;
  }

  /**
   * `send` inside a transaction the caller started (also the correction round of 3.16, created
   * and sent in one transaction). The caller logs after its commit.
   */
  async sendInTransaction(
    roundId: string,
    input: RoundSendInput,
    actor: TemplateActor,
    tx: Db,
  ): Promise<RoundSent> {
    const round = await this.repository.lockRound(roundId, tx);
    if (!round) throw new AppException('ROUND_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (round.status !== 'draft') {
      throw new AppException('ROUND_NOT_DRAFT', HttpStatus.CONFLICT, { status: round.status });
    }

    const rows = await this.repository.lockSendable(roundId, tx);
    const employerSignature = await this.settings.getEmployerSignature(tx);
    const templates = await this.checkTemplates(rows, employerSignature !== null, input, tx);

    const sentAt = round.now;
    const linkExpiresAt = linkExpiresAtFrom(sentAt, round.linkExpiryDays);
    const textFitCache: TextFitCache = new Map();
    const plan = planRoundSend({
      assignments: rows.map((row) => ({
        id: row.id,
        status: row.status,
        employee: sendableRecipient(row),
        template: mustGet(templates.byId, row.templateId),
      })),
      sendDay: todayInIsrael(sentAt),
      employerSignature,
      font: this.assets.font,
      textFitCache,
    });

    await this.repository.applyDecisions(plan.decisions, sentAt, tx);
    const toEmail = plan.decisions.flatMap(({ assignmentId, status, toEmail: address }) =>
      status === 'pending' && address ? [{ assignmentId, toEmail: address }] : [],
    );
    const invites = await this.repository.createSigningEmails('invite', toEmail, tx);
    const added = await this.queue.sendMany(
      INVITATION_QUEUE,
      invites.map(({ id, assignmentId }) => ({
        data: { assignmentId, emailMessageId: id },
        singletonKey: assignmentId,
      })),
      tx,
    );
    if (added !== invites.length) {
      // A job already waits for one of these assignments: never queue a second email.
      throw new Error(`Queued ${String(added)} of ${String(invites.length)} invitations`);
    }
    const status = invites.length > 0 ? 'sending' : 'active';
    await this.repository.markRoundSent(roundId, { status, sentAt, linkExpiresAt }, tx);

    const valuesSaved = plan.decisions.filter(({ fieldValues }) => fieldValues !== null).length;
    await this.audit.record(
      {
        actor: { type: 'user', userId: actor.userId },
        action: 'round.sent',
        entity: { type: 'round', id: roundId },
        ip: actor.ip,
        details: {
          templateIds: [...templates.byId.keys()],
          outdatedTemplateIds: templates.outdatedIds,
          linkExpiresAt: linkExpiresAt.toISOString(),
          counts: plan.counts,
          valuesSaved,
          textWarnings: plan.textWarnings.total,
        },
      },
      tx,
    );

    return {
      id: roundId,
      status,
      sentAt: sentAt.toISOString(),
      linkExpiresAt: linkExpiresAt.toISOString(),
      counts: plan.counts,
      outdatedTemplateIds: templates.outdatedIds,
      textWarnings: plan.textWarnings,
    } satisfies RoundSent;
  }

  /**
   * The round's own template versions (`assignments.template_id`), locked in id order and read
   * again. Not ready (incl. a missing employer signature image) → 409 `ROUND_TEMPLATE_NOT_READY`.
   * Archived or replaced by a newer version since creation, and not in the manager's
   * confirmation → 409 `ROUND_TEMPLATE_OUTDATED` with every such template. The round never
   * switches to a newer version.
   */
  private async checkTemplates(
    rows: readonly SendableRow[],
    imageUploaded: boolean,
    input: RoundSendInput,
    db: Db,
  ): Promise<{ byId: Map<string, CandidateTemplate>; outdatedIds: string[] }> {
    const ids = [...new Set(rows.map(({ templateId }) => templateId))].sort();
    for (const id of ids) await this.templates.lockTemplate(id, db);
    const byId = new Map<string, CandidateTemplate>();
    for (const row of await this.templates.findMany(ids, db)) {
      const fields = row.fields.map(toPosition);
      byId.set(row.id, { row, fields, usability: templateUsability(row, fields, imageUploaded) });
    }

    const notReady = [...byId.values()].filter(({ usability }) => !usability.isReady);
    if (notReady.length > 0) {
      throw new AppException('ROUND_TEMPLATE_NOT_READY', HttpStatus.CONFLICT, {
        templates: notReady.map((template) => ({
          ...templateRef(template),
          reasons: template.usability.notReadyReasons,
        })),
      });
    }

    const outdated = [...byId.values()].filter(({ usability }) => !usability.isActive);
    const confirmed = new Set(input.confirmOutdatedTemplateIds);
    if (outdated.some(({ row }) => !confirmed.has(row.id))) {
      const newest = await this.newestVersions(
        outdated.filter(({ row }) => !row.isLatest).map(({ row }) => row.id),
        db,
      );
      const count = (id: string) => rows.filter(({ templateId }) => templateId === id).length;
      const templates: RoundOutdatedTemplate[] = outdated.map((template) => ({
        ...templateRef(template),
        reason: template.row.isArchived ? 'archived' : 'newer_version',
        newestVersion: newest.get(template.row.id) ?? null,
        assignmentCount: count(template.row.id),
      }));
      throw new AppException('ROUND_TEMPLATE_OUTDATED', HttpStatus.CONFLICT, { templates });
    }
    return { byId, outdatedIds: outdated.map(({ row }) => row.id) };
  }

  /** The newest version number of each template's document (following `parent_template_id`). */
  private async newestVersions(ids: readonly string[], db: Db): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const links = await this.templates.versionLinks(db);
    const next = new Map<string, string>();
    for (const { id, parentTemplateId } of links)
      if (parentTemplateId) next.set(parentTemplateId, id);
    const last = new Map<string, string>();
    for (const id of ids) {
      let current = id;
      for (let step = next.get(current); step !== undefined; step = next.get(current)) {
        current = step;
      }
      last.set(id, current);
    }
    const rows = await this.templates.findMany([...new Set(last.values())], db);
    const version = new Map(rows.map((row) => [row.id, row.version]));
    return new Map(ids.map((id) => [id, version.get(last.get(id) ?? id) ?? 0]));
  }
}

/**
 * The employee of an assignment as the values step reads it: as stored now, with the
 * assignment's own department (at creation). Also used by the manual-handling send (3.16).
 */
export function sendableRecipient(
  row: Pick<SendableRow, 'department' | 'employee'>,
): RecipientEmployee {
  return {
    id: row.employee.id,
    employeeNumber: row.employee.employeeNumber,
    firstName: row.employee.firstName,
    lastName: row.employee.lastName,
    isActive: row.employee.isActive,
    emailStatus: row.employee.emailStatus,
    department: row.department,
    values: {
      firstName: row.employee.firstName,
      lastName: row.employee.lastName,
      idNumber: row.employee.idNumber,
      employeeNumber: row.employee.employeeNumber,
      email: row.employee.email,
      details: detailsFromRow(row.employee),
    },
  };
}

function mustGet<T>(map: ReadonlyMap<string, T>, key: string): T {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Template ${key} missing from the send`);
  return value;
}
