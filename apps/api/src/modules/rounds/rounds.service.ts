import {
  formatDepartment,
  type RoundCreated,
  type RoundCreateInput,
  type RoundSettings,
} from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { SettingsService } from '../../common/settings/settings.service.js';
import { TemplatesRepository } from '../templates/templates.repository.js';
import type { TemplateActor } from '../templates/templates.service.js';
import { countOutcomes } from './recipients-report.js';
import { planRound, type RoundPlan, templateFingerprint } from './round-plan.js';
import { RoundRecipientsService } from './round-recipients.service.js';
import { templateRef } from './round-templates.js';
import { RoundsRepository } from './rounds.repository.js';

/**
 * READ COMMITTED (the default), not a snapshot: a snapshot would be taken before waiting for the
 * creation lock, and would miss the round another manager just created.
 */
const CREATE_TRANSACTION = { maxWait: 10_000, timeout: 30_000 } as const;

/** Round creation (3.9, FR-RND-1 to FR-RND-5). Sending is 3.10. */
@Injectable()
export class RoundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: RoundsRepository,
    private readonly recipients: RoundRecipientsService,
    private readonly templates: TemplatesRepository,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates a draft round, its `round_templates` and one assignment per recipient, in one
   * transaction: the creation lock → settings → the 3.8 resolution (so preview and create agree)
   * → 409 while anything blocks → the templates locked (FR-TPL-4) and checked again → the rows
   * → one audit row. Nothing is sent.
   */
  async create(input: RoundCreateInput, actor: TemplateActor): Promise<RoundCreated> {
    return this.prisma.$transaction(
      (tx) => this.createInTransaction(input, actor, tx),
      CREATE_TRANSACTION,
    );
  }

  /**
   * `create` inside a transaction the caller started (also the correction round of 3.16, which
   * creates and sends in one transaction). `correctionOfAssignmentId` links a correction round
   * to the returned assignment it replaces.
   */
  async createInTransaction(
    input: RoundCreateInput,
    actor: TemplateActor,
    tx: Db,
    options: { correctionOfAssignmentId?: string } = {},
  ): Promise<RoundCreated> {
    const { name, settings: chosen, ...selection } = input;
    await this.repository.lockCreation(tx);
    const settings = await this.roundSettings(chosen, tx);
    const resolved = await this.recipients.resolve(selection, tx);
    if (resolved.blockers.length > 0) {
      throw new AppException('ROUND_CANNOT_BE_CREATED', HttpStatus.CONFLICT, {
        blockers: resolved.blockers,
      });
    }
    const plan = planRound({
      mode: selection.mode,
      departments: resolved.departments,
      recipients: resolved.recipients,
    });
    await this.lockTemplates(plan, tx);

    const round = await this.repository.createRound(
      {
        name,
        mode: selection.mode,
        settings,
        createdById: actor.userId,
        correctionOfAssignmentId: options.correctionOfAssignmentId ?? null,
      },
      tx,
    );
    await this.repository.createRoundTemplates(
      round.id,
      plan.roundTemplates.map(({ department, template }) => ({
        departmentId: department?.id ?? null,
        templateId: template.row.id,
      })),
      tx,
    );
    await this.repository.createAssignments(round.id, plan.assignments, tx);

    const counts = countOutcomes(resolved.recipients);
    const { recipients } = selection;
    await this.audit.record(
      {
        actor: { type: 'user', userId: actor.userId },
        action: 'round.created',
        entity: { type: 'round', id: round.id },
        ip: actor.ip,
        details: {
          mode: selection.mode,
          all: recipients.all,
          departmentCount: recipients.departmentIds.length,
          employeeIdCount: recipients.employeeIds.length,
          templateIds: usedTemplateIds(plan),
          alreadySigned: selection.alreadySigned,
          settings,
          counts,
        },
      },
      tx,
    );

    return {
      id: round.id,
      name,
      mode: selection.mode,
      status: 'draft',
      settings,
      linkExpiresAt: null,
      templates: plan.roundTemplates.map(({ department, template }) => ({
        departmentId: department?.id ?? null,
        department: department ? formatDepartment(department.code, department.name) : null,
        template: templateRef(template),
      })),
      counts,
      createdAt: round.createdAt.toISOString(),
    };
  }

  /** The defaults from the settings (3.18), each replaced by the manager's value when given. */
  private async roundSettings(
    chosen: RoundCreateInput['settings'],
    db: Db,
  ): Promise<RoundSettings> {
    const defaults = await this.settings.getRoundDefaults(db);
    return {
      remindersEnabled: chosen.remindersEnabled ?? true,
      reminderIntervalDays: chosen.reminderIntervalDays ?? defaults.reminderIntervalDays,
      maxReminders: chosen.maxReminders === undefined ? defaults.maxReminders : chosen.maxReminders,
      linkExpiryDays: chosen.linkExpiryDays ?? defaults.linkExpiryDays,
    };
  }

  /**
   * Locks every template the round uses (in id order), then reads them again: an edit, archive
   * or new version that started earlier has finished by now, and one that starts later waits
   * for this transaction and then makes a new version (the template is locked). Anything
   * different from what the resolution used → 409, nothing written.
   */
  private async lockTemplates(plan: RoundPlan, db: Db): Promise<void> {
    const used = new Map(plan.roundTemplates.map(({ template }) => [template.row.id, template]));
    const ids = [...used.keys()].sort();
    for (const id of ids) await this.templates.lockTemplate(id, db);
    const fresh = new Map((await this.templates.findMany(ids, db)).map((row) => [row.id, row]));
    const changed = ids.filter((id) => {
      const before = used.get(id);
      const after = fresh.get(id);
      return !before || !after || templateFingerprint(before.row) !== templateFingerprint(after);
    });
    if (changed.length > 0) {
      throw new AppException('ROUND_TEMPLATES_CHANGED', HttpStatus.CONFLICT, {
        templateIds: changed,
      });
    }
  }
}

/** The template ids of the round's `round_templates`, each once. */
function usedTemplateIds(plan: RoundPlan): string[] {
  return [...new Set(plan.roundTemplates.map(({ template }) => template.row.id))];
}
