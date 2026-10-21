import {
  formatDepartment,
  ROUND_PREVIEW_BLOCKERS,
  ROUND_PREVIEW_WARNINGS,
  type RecipientsPreviewReport,
  type RoundDepartmentStatus,
  type RoundPreviewBlockerCode,
  type RoundTemplateRef,
} from '@doc-signing/shared';
import type { FieldPosition } from '../templates/template-changes.js';
import type { TemplateRow } from '../templates/templates.repository.js';
import type { TemplateUsability } from '../templates/templates.service.js';

/** A template version as the round sees it: its row, positions (read once) and usability. */
export interface CandidateTemplate {
  row: TemplateRow;
  /** The positions read with `toPosition`, once per template (not per employee). */
  fields: FieldPosition[];
  usability: TemplateUsability;
}

export const isUsable = ({ usability }: CandidateTemplate) =>
  usability.isActive && usability.isReady;

export const templateRef = ({ row }: CandidateTemplate): RoundTemplateRef => ({
  id: row.id,
  name: row.name,
  version: row.version,
});

export interface RoundDepartment {
  id: string;
  code: number;
  name: string;
}

/** Which template one department of the round gets. */
export interface DepartmentPlan {
  department: RoundDepartment;
  status: RoundDepartmentStatus;
  /** Set when `status` is `ready`. */
  template: CandidateTemplate | null;
  /** by_department: the ready templates linked to the department. */
  options: CandidateTemplate[];
  /** Linked to the department but not usable (archived versions are never loaded). */
  notOffered: CandidateTemplate[];
}

type Blocker = RecipientsPreviewReport['blockers'][number];
type Warning = RecipientsPreviewReport['warnings'][number];

export function blocker(
  code: RoundPreviewBlockerCode,
  ids: { departmentId?: string; templateId?: string } = {},
  reasons: Blocker['reasons'] = [],
): Blocker {
  return {
    code,
    message: ROUND_PREVIEW_BLOCKERS[code],
    departmentId: ids.departmentId ?? null,
    templateId: ids.templateId ?? null,
    reasons,
  };
}

const byCode = (a: RoundDepartment, b: RoundDepartment) => a.code - b.code;

/**
 * single_template (FR-RND-1): one template for every department. A template that isn't active
 * or isn't ready still gets a full preview, with a blocker (3.9 refuses it).
 */
export function planSingleTemplate(
  template: CandidateTemplate,
  departments: readonly RoundDepartment[],
): { departments: DepartmentPlan[]; blockers: Blocker[] } {
  const { usability, row } = template;
  const blockers: Blocker[] = [];
  if (!usability.isActive) blockers.push(blocker('TEMPLATE_NOT_ACTIVE', { templateId: row.id }));
  if (!usability.isReady) {
    blockers.push(blocker('TEMPLATE_NOT_READY', { templateId: row.id }, usability.notReadyReasons));
  }
  return {
    departments: [...departments].sort(byCode).map((department) => ({
      department,
      status: 'ready',
      template,
      options: [],
      notOffered: [],
    })),
    blockers,
  };
}

/**
 * by_department (FR-RND-3, 3.5 note): each department gets the one ready template linked to it;
 * with several, the manager's choice; with none, a warning and its employees are left out.
 * A choice that isn't one of the department's ready templates is a blocker (never guessed).
 * Blockers and warnings only for departments that have active recipients.
 */
export function planByDepartment(input: {
  departments: readonly RoundDepartment[];
  /** Active versions linked to any of these departments (`activeForDepartments`). */
  linked: readonly CandidateTemplate[];
  /** departmentId → templateId, from the body. */
  choices: ReadonlyMap<string, string>;
  /** departmentId → number of active recipients there. */
  activeRecipients: ReadonlyMap<string, number>;
}): { departments: DepartmentPlan[]; blockers: Blocker[]; warnings: Warning[] } {
  const blockers: Blocker[] = [];
  const warnings: Warning[] = [];
  const plans = [...input.departments].sort(byCode).map((department): DepartmentPlan => {
    const mine = input.linked.filter(({ row }) =>
      row.departments.some(({ id }) => id === department.id),
    );
    const options = mine.filter(isUsable);
    const notOffered = mine.filter((template) => !isUsable(template));
    const counts = (input.activeRecipients.get(department.id) ?? 0) > 0;
    const plan = (status: RoundDepartmentStatus, template: CandidateTemplate | null) => ({
      department,
      status,
      template,
      options: status === 'ready' && options.length === 1 ? [] : options,
      notOffered,
    });

    const chosenId = input.choices.get(department.id);
    if (chosenId !== undefined) {
      const chosen = options.find(({ row }) => row.id === chosenId);
      if (chosen) return plan('ready', chosen);
      if (counts) {
        blockers.push(
          blocker('DEPARTMENT_TEMPLATE_CHOICE_INVALID', {
            departmentId: department.id,
            templateId: chosenId,
          }),
        );
      }
      return plan(options.length === 0 ? 'no_template' : 'choice_needed', null);
    }
    const [only] = options;
    if (options.length === 1 && only) return plan('ready', only);
    if (options.length === 0) {
      if (counts) {
        warnings.push({
          code: 'DEPARTMENT_HAS_NO_TEMPLATE',
          message: ROUND_PREVIEW_WARNINGS.DEPARTMENT_HAS_NO_TEMPLATE,
          departmentId: department.id,
        });
      }
      return plan('no_template', null);
    }
    if (counts) {
      blockers.push(blocker('DEPARTMENT_TEMPLATE_CHOICE_NEEDED', { departmentId: department.id }));
    }
    return plan('choice_needed', null);
  });
  return { departments: plans, blockers, warnings };
}

/** The department's report row ("15 - name", its template, options, the reasons not offered). */
export function departmentReport(
  plan: DepartmentPlan,
  recipients: number,
): RecipientsPreviewReport['departments'][number] {
  const { department } = plan;
  return {
    id: department.id,
    code: department.code,
    label: formatDepartment(department.code, department.name),
    recipients,
    status: plan.status,
    template: plan.template && templateRef(plan.template),
    options: plan.options.map(templateRef),
    notOffered: plan.notOffered.map((template) => ({
      ...templateRef(template),
      reasons: template.usability.notReadyReasons,
    })),
  };
}
