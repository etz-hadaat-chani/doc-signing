import {
  type AssignmentRow,
  type AssignmentTableQuery,
  formatDepartment,
  type Paged,
  requestedDisplayStatuses,
  type RoundDetails,
  type RoundListItem,
  type RoundListQuery,
} from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { RoundSendRepository } from '../rounds/round-send.repository.js';
import type { TemplateActor } from '../templates/templates.service.js';
import {
  countBlock,
  countsOf,
  distinctDocuments,
  roundBase,
  signedOf,
  toAssignmentRow,
} from './tracking-rows.js';
import { TrackingRepository } from './tracking.repository.js';

/** Group rows by key. */
function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
  return groups;
}

/**
 * Reading rounds (3.11, FR-TRK-2): the round list, one round's details and its employee table.
 * Reads only; the one write is the audit row of a table page that shows given emails.
 */
@Injectable()
export class RoundsReadService {
  constructor(
    private readonly repository: TrackingRepository,
    private readonly sending: RoundSendRepository,
    private readonly audit: AuditService,
  ) {}

  /** Rounds, newest first, with their templates and % signed (4 queries per page). */
  async list(query: RoundListQuery, now = new Date()): Promise<Paged<RoundListItem>> {
    const { rows, total } = await this.repository.roundPage(
      query.status,
      query.page,
      query.pageSize,
    );
    const ids = rows.map(({ id }) => id);
    const [counts, documents] = await Promise.all([
      this.repository.countsByRound(ids, now),
      this.repository.roundDocuments(ids),
    ]);
    const countsByRound = groupBy(counts, ({ key }) => key);
    const documentsByRound = groupBy(documents, ({ roundId }) => roundId);
    const items = rows.map((round): RoundListItem => {
      const byStatus = countsOf(countsByRound.get(round.id) ?? []);
      const block = countBlock(byStatus);
      return {
        ...roundBase(round, now),
        documents: distinctDocuments(documentsByRound.get(round.id) ?? []),
        recipients: block.total,
        signed: signedOf(byStatus),
        percentSigned: round.status === 'draft' ? null : block.percentSigned,
      };
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** One round: settings, templates, progress, counts (all and per department), link back. */
  async details(id: string, now = new Date()): Promise<RoundDetails> {
    const round = await this.repository.roundHeader(id);
    if (!round) throw new AppException('ROUND_NOT_FOUND', HttpStatus.NOT_FOUND);
    const [documents, departments, progress] = await Promise.all([
      this.repository.roundDocuments([id]),
      this.repository.countsByDepartment(id, now),
      round.status === 'draft' ? null : this.sending.inviteProgress(id),
    ]);
    const all = countBlock(countsOf(departments));
    const byDepartment = [...groupBy(departments, ({ key }) => key).values()].map((rows) => {
      const [first] = rows as [(typeof rows)[number]];
      return {
        id: first.key,
        code: first.code,
        label: formatDepartment(first.code, first.name),
        ...countBlock(countsOf(rows)),
      };
    });
    return {
      ...roundBase(round, now),
      documents: distinctDocuments(documents),
      createdBy: { id: round.createdById, fullName: round.createdByName },
      settings: {
        remindersEnabled: round.remindersEnabled,
        reminderIntervalDays: round.reminderIntervalDays,
        maxReminders: round.maxReminders,
        linkExpiryDays: round.linkExpiryDays,
      },
      templates: documents.map((doc) => ({
        departmentId: doc.departmentId,
        department:
          doc.departmentCode === null || doc.departmentName === null
            ? null
            : formatDepartment(doc.departmentCode, doc.departmentName),
        template: { id: doc.id, name: doc.name, version: doc.version },
      })),
      progress:
        progress === null
          ? null
          : { ...progress, total: progress.queued + progress.sent + progress.failed },
      counts: {
        ...all,
        percentSigned: round.status === 'draft' ? null : all.percentSigned,
        cancelledInactiveAtSend: departments.reduce((sum, row) => sum + row.inactiveAtSend, 0),
      },
      departments: byDepartment,
      correctionOf:
        round.correctionOfAssignmentId === null || round.correctionOfRoundId === null
          ? null
          : {
              roundId: round.correctionOfRoundId,
              roundName: round.correctionOfRoundName ?? '',
              assignmentId: round.correctionOfAssignmentId,
            },
    };
  }

  /**
   * One page of the employee table (filters AND, search by name / employee number / ID). A page
   * that shows addresses employees gave is logged (NFR-PRV-7), with counts only.
   */
  async table(
    roundId: string,
    query: AssignmentTableQuery,
    actor: TemplateActor,
    now = new Date(),
  ): Promise<Paged<AssignmentRow>> {
    if (!(await this.repository.roundExists(roundId))) {
      throw new AppException('ROUND_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    const { rows, total } = await this.repository.assignmentPage(
      {
        roundId,
        statuses: requestedDisplayStatuses(query),
        departmentId: query.dept,
        q: query.q,
        page: query.page,
        pageSize: query.pageSize,
      },
      now,
    );
    const items = rows.map(toAssignmentRow);
    const emailAnswersShown = items.filter(({ emailAnswer }) => emailAnswer?.email).length;
    if (emailAnswersShown > 0) {
      await this.audit.record({
        actor: { type: 'user', userId: actor.userId },
        action: 'round.assignments_viewed',
        entity: { type: 'round', id: roundId },
        ip: actor.ip,
        details: {
          page: query.page,
          pageSize: query.pageSize,
          rowCount: items.length,
          emailAnswersShown,
          searched: query.q !== undefined,
        },
      });
    }
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
