import {
  type Approved,
  type ApprovalRow,
  type ApprovalsQuery,
  type AssignmentAnswer,
  type AssignmentResponses,
  EMAIL_ANSWER_KEY,
  EMAIL_CHOICE_KEY,
  EMAIL_CHOICE_LABELS,
  EMAIL_CHOICES,
  type EmailChoice,
  formatDepartment,
  type Paged,
  type Returned,
  type ReturnBody,
  type SentAgain,
} from '@doc-signing/shared';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { MAX_DOWNLOAD_LINK_SECONDS, StorageAdapter } from '../../common/storage/storage.adapter.js';
import { Prisma } from '../../generated/prisma/client.js';
import { boxLabel } from '../rounds/recipient-outcome.js';
import { RoundActionsRepository } from '../rounds/round-actions.repository.js';
import type { Refusal } from '../rounds/round-actions.rules.js';
import { RoundSendService } from '../rounds/round-send.service.js';
import { RoundsService } from '../rounds/rounds.service.js';
import type { TemplateActor } from '../templates/templates.service.js';
import {
  type ApprovalListRow,
  type ApprovalReason,
  ApprovalsRepository,
  type StoredAnswer,
} from './approvals.repository.js';
import { approvalRefusal, correctionRoundName, sendAgainRefusal } from './approvals.rules.js';

/** READ COMMITTED, like the round actions: the round row lock makes actions run in turn. */
const APPROVAL_TRANSACTION = { maxWait: 10_000, timeout: 30_000 } as const;

const isEmailChoice = (value: string | null): value is EmailChoice =>
  (EMAIL_CHOICES as readonly (string | null)[]).includes(value);

/**
 * Manager approval (3.16 part B2, FR-TRK-6): the waiting list and the answers (managers and
 * officers), approve, return for correction and "send again" (managers). Every action runs in one
 * transaction under the round lock, then the row lock (the 3.12 order). Audit rows and log lines
 * carry ids and counts only: never an answer, an address, a name or the return note.
 */
@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ApprovalsRepository,
    private readonly actions: RoundActionsRepository,
    private readonly rounds: RoundsService,
    private readonly send: RoundSendService,
    private readonly storage: StorageAdapter,
    private readonly audit: AuditService,
  ) {}

  /** Signed documents waiting for approval, across rounds, oldest signature first. */
  async list(query: ApprovalsQuery): Promise<Paged<ApprovalRow>> {
    const { rows, total } = await this.repository.page(query);
    const reasons = await this.repository.reasons(rows.map(({ assignmentId }) => assignmentId));
    return {
      items: rows.map((row) => toApprovalRow(row, reasons)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * Everything the employee filled in (FR-TRK-6), in template order; drawings as storage links
   * valid `MAX_DOWNLOAD_LINK_SECONDS` (5 minutes). Logged as a view, with counts only.
   */
  async responses(assignmentId: string, actor: TemplateActor): Promise<AssignmentResponses> {
    const facts = await this.repository.responsesFacts(assignmentId);
    if (!facts) throw new AppException('ASSIGNMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    const stored = await this.repository.answers(assignmentId);
    const expiresAt = new Date(Date.now() + MAX_DOWNLOAD_LINK_SECONDS * 1000).toISOString();

    const answers: AssignmentAnswer[] = [];
    for (const answer of stored) {
      if (answer.key === EMAIL_CHOICE_KEY || answer.key === EMAIL_ANSWER_KEY) continue;
      answers.push(await this.toAnswer(answer, expiresAt));
    }
    const choice = stored.find(({ key }) => key === EMAIL_CHOICE_KEY)?.value ?? null;
    const given = stored.find(({ key }) => key === EMAIL_ANSWER_KEY)?.value ?? null;
    const emailAnswer = isEmailChoice(choice)
      ? {
          choice,
          choiceLabel: EMAIL_CHOICE_LABELS[choice],
          email: choice === 'email' ? given : null,
          differsFromStored:
            choice === 'email' &&
            given !== null &&
            (await this.repository.emailDiffers(assignmentId)),
        }
      : null;

    await this.audit.record({
      actor: { type: 'user', userId: actor.userId },
      action: 'assignment.responses_viewed',
      entity: { type: 'assignment', id: assignmentId },
      ip: actor.ip,
      details: {
        roundId: facts.roundId,
        answerCount: answers.length,
        drawingCount: answers.filter(({ drawing }) => drawing !== null).length,
        emailShown: emailAnswer?.email != null,
      },
    });
    const waiting = facts.status === 'signed' && facts.needsApproval;
    return {
      assignmentId,
      roundId: facts.roundId,
      status: facts.status,
      approval: waiting ? (facts.approvedAt ? 'approved' : 'waiting') : null,
      returnedAt: facts.returnedAt?.toISOString() ?? null,
      returnNote: facts.returnedAt ? facts.returnNote : null,
      answers,
      emailAnswer,
    };
  }

  /** Approve (FR-TRK-6): `approved_at` / `approved_by`; the signed PDF is never touched. */
  async approve(assignmentId: string, actor: TemplateActor): Promise<Approved> {
    const roundId = await this.roundOf(assignmentId);
    const approvedAt = await this.prisma.$transaction(async (tx) => {
      await this.lockApprovable(roundId, assignmentId, tx);
      const at = await this.repository.approve(assignmentId, actor.userId, tx);
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'assignment.approved',
          entity: { type: 'assignment', id: assignmentId },
          ip: actor.ip,
          details: { roundId },
        },
        tx,
      );
      return at;
    }, APPROVAL_TRANSACTION);
    return { assignmentId, approvedAt: approvedAt.toISOString() };
  }

  /**
   * Return for correction (FR-TRK-6): `cancelled` with the note; every link shows "cancelled";
   * the signed PDF stays stored as proof. The note is never in the audit row.
   */
  async returnForCorrection(
    assignmentId: string,
    body: ReturnBody,
    actor: TemplateActor,
  ): Promise<Returned> {
    const roundId = await this.roundOf(assignmentId);
    const returnedAt = await this.prisma.$transaction(async (tx) => {
      await this.lockApprovable(roundId, assignmentId, tx);
      const at = await this.repository.markReturned(
        { assignmentId, userId: actor.userId, note: body.note },
        tx,
      );
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'assignment.returned',
          entity: { type: 'assignment', id: assignmentId },
          ip: actor.ip,
          details: { roundId, fromStatus: 'signed' },
        },
        tx,
      );
      return at;
    }, APPROVAL_TRANSACTION);
    return { assignmentId, status: 'cancelled', returnedAt: returnedAt.toISOString() };
  }

  /**
   * "Send again" after a return (FR-TRK-6), in one transaction: the original round and row
   * locked (a second call waits here, then gets 409 with the round made by the first) → the
   * rules → the newest version of the same template → the 3.9 creation (creation lock, then the
   * templates) of a one-employee `single_template` round with the default settings, linked to
   * the returned assignment → the 3.10 send of that round (its invitation carries the correction
   * line, never the note) → one audit row.
   */
  async sendAgain(assignmentId: string, actor: TemplateActor): Promise<SentAgain> {
    const roundId = await this.roundOf(assignmentId);
    try {
      const sent = await this.prisma.$transaction(async (tx) => {
        if (!(await this.actions.lockRound(roundId, tx))) {
          throw new Error('Round gone while sending again');
        }
        const target = await this.repository.lockReturnedTarget(assignmentId, tx);
        if (!target) throw new Error('Assignment gone while sending again');
        refuseIfNeeded(sendAgainRefusal(target));
        if (!target.templateId) throw new Error(`Assignment ${assignmentId} has no template`);

        const templateId = await this.repository.newestVersionOf(target.templateId, tx);
        const created = await this.rounds.createInTransaction(
          {
            mode: 'single_template',
            templateId,
            recipients: { all: false, departmentIds: [], employeeIds: [target.employeeId] },
            alreadySigned: 'send_again',
            name: correctionRoundName(target.roundName, target.firstName, target.lastName),
            settings: {},
          },
          actor,
          tx,
          { correctionOfAssignmentId: assignmentId },
        );
        const round = await this.send.sendInTransaction(
          created.id,
          { confirmOutdatedTemplateIds: [] },
          actor,
          tx,
        );
        const assignment = await this.repository.onlyAssignment(created.id, tx);
        const [template] = created.templates;
        if (!template) throw new Error(`Correction round ${created.id} has no template`);

        await this.audit.record(
          {
            actor: { type: 'user', userId: actor.userId },
            action: 'assignment.sent_again',
            entity: { type: 'assignment', id: assignmentId },
            ip: actor.ip,
            details: {
              roundId,
              correctionRoundId: created.id,
              templateId: template.template.id,
              status: assignment.status,
            },
          },
          tx,
        );
        return {
          roundId: created.id,
          name: created.name,
          status: round.status,
          sentAt: round.sentAt,
          linkExpiresAt: round.linkExpiresAt,
          template: template.template,
          assignment,
        } satisfies SentAgain;
      }, APPROVAL_TRANSACTION);
      this.logger.log(
        `Assignment ${assignmentId}: correction round ${sent.roundId} sent (${sent.assignment.status})`,
      );
      return sent;
    } catch (error) {
      // The lock above makes this unreachable in practice; the UNIQUE is the last guard.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.repository.correctionRoundOf(assignmentId);
        if (existing) {
          throw new AppException('CORRECTION_ROUND_EXISTS', HttpStatus.CONFLICT, {
            roundId: existing,
          });
        }
      }
      throw error;
    }
  }

  private async roundOf(assignmentId: string): Promise<string> {
    const roundId = await this.actions.roundOfAssignment(assignmentId);
    if (!roundId) throw new AppException('ASSIGNMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    return roundId;
  }

  /** The round row, then the assignment row (FOR UPDATE), then the approval rule. */
  private async lockApprovable(roundId: string, assignmentId: string, tx: Db): Promise<void> {
    if (!(await this.actions.lockRound(roundId, tx))) throw new Error('Round gone while approving');
    const target = await this.repository.lockApprovalTarget(assignmentId, tx);
    if (!target) throw new Error('Assignment gone while approving');
    refuseIfNeeded(approvalRefusal(target));
  }

  private async toAnswer(answer: StoredAnswer, expiresAt: string): Promise<AssignmentAnswer> {
    const drawing = answer.fileKey
      ? {
          url: await this.storage.createDownloadLink(answer.fileKey, {
            fileName: `${answer.key}.png`,
            disposition: 'inline',
            expiresInSeconds: MAX_DOWNLOAD_LINK_SECONDS,
          }),
          expiresAt,
        }
      : null;
    return {
      key: answer.key,
      label: answer.fieldType
        ? boxLabel({ fieldType: answer.fieldType, label: answer.label }, answer.key)
        : answer.key,
      type: answer.fieldType ?? 'text',
      needsApproval: answer.needsApproval,
      value: answer.fileKey ? null : answer.value,
      drawing,
    };
  }
}

function refuseIfNeeded(refusal: Refusal | null): void {
  if (refusal) throw new AppException(refusal.code, HttpStatus.CONFLICT, refusal.details);
}

function toApprovalRow(row: ApprovalListRow, reasons: readonly ApprovalReason[]): ApprovalRow {
  return {
    assignmentId: row.assignmentId,
    round: {
      id: row.roundId,
      name: row.roundName,
      status: row.roundStatus,
      isCorrection: row.isCorrection,
    },
    document: { id: row.templateId, name: row.templateName, version: row.templateVersion },
    department: {
      id: row.departmentId,
      code: row.departmentCode,
      label: formatDepartment(row.departmentCode, row.departmentName),
    },
    employee: {
      id: row.employeeId,
      employeeNumber: row.employeeNumber,
      firstName: row.firstName,
      lastName: row.lastName,
    },
    signedAt: row.signedAt.toISOString(),
    signMethod: row.signMethod,
    reasons: reasons
      .filter(({ assignmentId }) => assignmentId === row.assignmentId)
      .map(({ key, fieldType, label }) => ({ key, label: boxLabel({ fieldType, label }, key) })),
  };
}
