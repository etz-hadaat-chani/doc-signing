import {
  type ErrorCode,
  type ManualListQuery,
  type ManualReady,
  type ManualRow,
  type ManualSendInput,
  type ManualSent,
  MAX_UNLOCKS,
  type Paged,
  type SavedEmployerSignature,
  todayInIsrael,
} from '@doc-signing/shared';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { SettingsService } from '../../common/settings/settings.service.js';
import { PdfAssetsService } from '../pdf-filler/pdf-assets.service.js';
import type { TextFitCache } from '../pdf-filler/pdf-text.js';
import { resolveRecipient, type ResolvedRecipient } from '../rounds/recipient-outcome.js';
import type { ActionRound } from '../rounds/round-actions.rules.js';
import {
  type ActionRoundRow,
  type ActionRow,
  RoundActionsRepository,
} from '../rounds/round-actions.repository.js';
import { sendableRecipient } from '../rounds/round-send.service.js';
import type { CandidateTemplate } from '../rounds/round-templates.js';
import { SigningEmailQueue } from '../rounds/signing-email-queue.js';
import { toPosition } from '../templates/stored-position.js';
import { TemplatesRepository } from '../templates/templates.repository.js';
import { type TemplateActor, templateUsability } from '../templates/templates.service.js';
import {
  type ManualListRow,
  ManualHandlingRepository,
  type ValuesInput,
} from './manual-handling.repository.js';
import { manualSendRefusal, type ManualSendTarget } from './manual-handling.rules.js';

/** Like the round actions (3.12): READ COMMITTED; the round row locks make actions run in turn. */
const SEND_TRANSACTION = { maxWait: 10_000, timeout: 30_000 } as const;

/** One refused row of a send: nothing is sent when any row is refused. */
interface RefusedRow {
  assignmentId: string;
  code: ErrorCode;
  /** `MISSING_DATA_STILL_MISSING`: the names of the values still missing (never the values). */
  missing?: string[];
}

/** What a row of the send does. */
interface SendStep {
  row: ActionRow;
  toStatus: 'pending' | 'no_email';
  /** `missing_data` only: the values saved now. */
  completed: ResolvedRecipient | null;
}

/**
 * Manual handling (3.16 part A, FR-MAN-1, FR-EMP-6): the list and the one-click send. "Ready to
 * send" is the send's own rule (`manualSendRefusal` and the values step) run on the facts the
 * list query reads, so the list and the send never disagree. Nothing is ever sent without the
 * manager's send: an import only makes rows ready.
 */
@Injectable()
export class ManualHandlingService {
  private readonly logger = new Logger(ManualHandlingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ManualHandlingRepository,
    private readonly actions: RoundActionsRepository,
    private readonly emails: SigningEmailQueue,
    private readonly templates: TemplatesRepository,
    private readonly settings: SettingsService,
    private readonly assets: PdfAssetsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * One page of the list. "Details completed" needs the 3.6 values step (the same as the send),
   * which is code, not SQL: it runs on this page's `missing_data` rows only.
   */
  async list(query: ManualListQuery): Promise<Paged<ManualRow>> {
    const { rows, total } = await this.repository.listPage({
      roundId: query.roundId,
      departmentId: query.dept,
      kinds: query.kind ?? null,
      q: query.q,
      page: query.page,
      pageSize: query.pageSize,
    });
    const missingIds = rows
      .filter((row) => row.kind === 'missing_data')
      .map((row) => row.assignmentId);
    const resolved = await this.resolveDetails(missingIds, rows[0]?.now ?? new Date(), this.prisma);
    const unlocks = await this.actions.unlockCounts(rows.map(({ assignmentId }) => assignmentId));
    return {
      items: rows.map((row) =>
        toItem(row, resolved.get(row.assignmentId) ?? null, unlocks.get(row.assignmentId) ?? 0),
      ),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * The values step on today's employee card, for `missing_data` rows: what is still missing,
   * the values to save and whether she has an email now (3.8 `resolveRecipient`, with the same
   * inputs as the round send's `planRoundSend`).
   */
  private async resolveDetails(
    assignmentIds: readonly string[],
    now: Date,
    db: Db,
  ): Promise<Map<string, ResolvedRecipient>> {
    const result = new Map<string, ResolvedRecipient>();
    if (assignmentIds.length === 0) return result;
    const inputs = await this.repository.valuesInputs(assignmentIds, db);
    const employerSignature = await this.settings.getEmployerSignature(db);
    const templates = await this.candidates(inputs, employerSignature, db);
    const sendDay = todayInIsrael(now);
    const textFitCache: TextFitCache = new Map();
    for (const input of inputs) {
      result.set(
        input.id,
        resolveRecipient({
          employee: sendableRecipient(input),
          pickedByHand: false,
          departmentStatus: 'ready',
          template: mustGet(templates, input.templateId),
          signedBefore: null,
          openElsewhere: null,
          alreadySigned: 'send_again',
          sendDay,
          employerSignature,
          font: this.assets.font,
          textFitCache,
        }),
      );
    }
    return result;
  }

  /** The assignments' own template versions (never a newer one), with their readiness. */
  private async candidates(
    inputs: readonly ValuesInput[],
    employerSignature: SavedEmployerSignature | null,
    db: Db,
  ): Promise<Map<string, CandidateTemplate>> {
    const ids = [...new Set(inputs.map(({ templateId }) => templateId))];
    const byId = new Map<string, CandidateTemplate>();
    for (const row of await this.templates.findMany(ids, db)) {
      const fields = row.fields.map(toPosition);
      byId.set(row.id, {
        row,
        fields,
        usability: templateUsability(row, fields, employerSignature !== null),
      });
    }
    return byId;
  }

  /**
   * The one-click send (one or several rows): all of them, or none (409, every refused row in
   * `details.refused`). One transaction: the rounds locked in id order, then the rows in id
   * order (3.10 / 3.12 order), the rules, the values step for `missing_data`, the changes, one
   * new invitation each (`queued` row + job, committed together), one audit row each.
   */
  async send(input: ManualSendInput, actor: TemplateActor): Promise<ManualSent> {
    const ids = [...input.assignmentIds].sort();
    const sent = await this.prisma.$transaction(async (tx) => {
      const roundOf = await this.repository.roundsOf(ids, tx);
      const unknown = ids.filter((id) => !roundOf.has(id));
      if (unknown.length > 0) {
        throw new AppException('ASSIGNMENT_NOT_FOUND', HttpStatus.NOT_FOUND, {
          assignmentIds: unknown,
        });
      }
      const rounds = new Map<string, ActionRoundRow>();
      for (const roundId of [...new Set(roundOf.values())].sort()) {
        const round = await this.actions.lockRound(roundId, tx);
        if (!round) throw new Error(`Round ${roundId} of an assignment is missing`);
        rounds.set(roundId, round);
      }
      const rows = await this.actions.lockRows({ assignmentIds: ids }, tx);
      const inputs = await this.repository.valuesInputs(ids, tx);
      const active = new Map(inputs.map(({ id, employee }) => [id, employee.isActive]));
      const roundFor = (row: ActionRow) => mustGet(rounds, row.roundId);

      const refused: RefusedRow[] = [];
      const passed: ActionRow[] = [];
      for (const row of rows) {
        const target: ManualSendTarget = { ...row, employeeActive: mustGet(active, row.id) };
        const refusal = manualSendRefusal(target, roundFor(row));
        if (refusal) refused.push({ assignmentId: row.id, code: refusal.code });
        else passed.push(row);
      }
      const details = await this.resolveDetails(
        passed.filter((row) => row.status === 'missing_data').map((row) => row.id),
        roundFor(must(rows[0])).now,
        tx,
      );
      const steps: SendStep[] = [];
      for (const row of passed) {
        const step = sendStep(row, details.get(row.id) ?? null);
        if ('code' in step) refused.push(step);
        else steps.push(step);
      }
      if (refused.length > 0) {
        refused.sort((a, b) => a.assignmentId.localeCompare(b.assignmentId));
        throw new AppException(must(refused[0]).code, HttpStatus.CONFLICT, { refused });
      }
      return this.apply(steps, roundFor, actor, tx);
    }, SEND_TRANSACTION);
    const queued = sent.items.filter(({ emailMessageId }) => emailMessageId !== null).length;
    this.logger.log(`Manual handling: queued ${String(queued)} invitations`);
    return sent;
  }

  /** The changes (repositories), the invitations and the audit rows of an accepted send. */
  private async apply(
    steps: readonly SendStep[],
    roundFor: (row: ActionRow) => ActionRoundRow,
    actor: TemplateActor,
    tx: Db,
  ): Promise<ManualSent> {
    for (const { row, toStatus, completed } of steps) {
      if (completed) {
        const values = must(completed.fieldValues);
        await this.repository.saveCompletedDetails(row.id, toStatus, values, tx);
      } else if (row.status === 'invalid_email') {
        await this.actions.reopenForResend(row.id, tx);
      } else {
        await this.repository.reopenNoEmail(row.id, tx);
      }
    }
    const toEmail = steps.filter(({ toStatus }) => toStatus === 'pending');
    const emailIds = await this.emails.queue(
      'invite',
      toEmail.map(({ row }) => ({ assignmentId: row.id, toEmail: must(row.validEmail) })),
      tx,
    );
    const emailOf = new Map(toEmail.map(({ row }, index) => [row.id, must(emailIds[index])]));
    const items: ManualSent['items'] = [];
    for (const { row, toStatus, completed } of steps) {
      const emailMessageId = emailOf.get(row.id) ?? null;
      const roundId = roundFor(row).id;
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'assignment.manual_send',
          entity: { type: 'assignment', id: row.id },
          ip: actor.ip,
          details: {
            roundId,
            fromStatus: row.status,
            toStatus,
            emailMessageId,
            valuesSaved: completed !== null,
          },
        },
        tx,
      );
      items.push({ assignmentId: row.id, roundId, status: toStatus, emailMessageId });
    }
    return { items };
  }
}

/**
 * What an accepted row does. `no_email` / `invalid_email`: back to `pending` with its saved
 * values, and an invitation. `missing_data`: the values step on today's card — still missing →
 * refused; complete → saved, then `pending` + invitation, or `no_email` without a valid email.
 */
function sendStep(row: ActionRow, completed: ResolvedRecipient | null): SendStep | RefusedRow {
  if (row.status !== 'missing_data') return { row, toStatus: 'pending', completed: null };
  const resolved = must(completed);
  if (resolved.template && !resolved.template.usability.isReady) {
    return { assignmentId: row.id, code: 'ROUND_TEMPLATE_NOT_READY' };
  }
  if (resolved.outcome === 'missing_data') {
    return {
      assignmentId: row.id,
      code: 'MISSING_DATA_STILL_MISSING',
      missing: resolved.missing.map(({ name }) => name),
    };
  }
  if (resolved.outcome === 'no_email') return { row, toStatus: 'no_email', completed: resolved };
  if (resolved.outcome === 'email' && row.validEmail !== null) {
    return { row, toStatus: 'pending', completed: resolved };
  }
  // `inactive` was refused by the rule already; nothing else comes from a given template.
  throw new Error(`Unexpected outcome ${resolved.outcome} in a manual send`);
}

/**
 * One list row: the send's rule on the row's facts says whether it is ready (never a
 * `locked` or `email_corrected` row: their statuses aren't sendable).
 */
function toItem(
  row: ManualListRow,
  resolved: ResolvedRecipient | null,
  unlocksUsed: number,
): ManualRow {
  const target: ManualSendTarget = {
    status: row.status,
    locked: row.locked,
    validEmail: row.validEmail,
    emailQueued: row.emailQueued,
    lastEmailAt: null,
    lastEmailFailed: false,
    failedAddress: row.failedAddress,
    employeeActive: row.employeeActive,
  };
  const round: ActionRound = {
    status: row.roundStatus,
    linkExpiresAt: row.linkExpiresAt,
    now: row.now,
  };
  const sendable = row.kind !== 'email_corrected' && manualSendRefusal(target, round) === null;
  const stillMissing = resolved?.outcome === 'missing_data';
  let ready: ManualReady | null = null;
  if (sendable && row.kind === 'no_email') ready = 'email_added';
  if (sendable && row.kind === 'invalid_email') ready = 'email_fixed';
  if (sendable && row.kind === 'missing_data' && resolved && !stillMissing) {
    ready = 'details_completed';
  }
  const emailReady = ready === 'email_added' || ready === 'email_fixed';
  return {
    assignmentId: row.assignmentId,
    kind: row.kind,
    status: row.status,
    round: { id: row.roundId, name: row.roundName },
    documentName: row.documentName,
    department: { id: row.departmentId, code: row.departmentCode, name: row.departmentName },
    employee: {
      id: row.employeeId,
      employeeNumber: row.employeeNumber,
      firstName: row.firstName,
      lastName: row.lastName,
      isActive: row.employeeActive,
      emailStatus: row.emailStatus,
    },
    ready,
    newEmail: emailReady ? row.validEmail : null,
    missing: stillMissing ? resolved.missing.map(({ name }) => name) : [],
    emailCorrection:
      row.kind === 'email_corrected'
        ? { stored: row.storedEmail, given: must(row.givenEmail) }
        : null,
    locked: row.locked,
    unlocksLeft: Math.max(0, MAX_UNLOCKS - unlocksUsed),
    linkExpired: row.linkExpiresAt !== null && row.linkExpiresAt.getTime() <= row.now.getTime(),
    sentAt: row.sentAt?.toISOString() ?? null,
    signedAt: row.signedAt?.toISOString() ?? null,
  };
}

function mustGet<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error('A value read for this send is missing');
  return value;
}

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('A value the rules checked is missing');
  }
  return value;
}
