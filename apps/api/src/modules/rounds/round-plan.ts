import type { AssignmentStatus, RoundMode } from '@doc-signing/shared';
import type { TemplateRow } from '../templates/templates.repository.js';
import type { RecipientOutcome, ResolvedRecipient } from './recipient-outcome.js';
import type { CandidateTemplate, DepartmentPlan, RoundDepartment } from './round-templates.js';

/** The status each outcome that adds the employee gets (3.9): nothing is sent yet. */
export const ASSIGNMENT_STATUS_OF: Partial<Record<RecipientOutcome, AssignmentStatus>> = {
  email: 'pending',
  no_email: 'no_email',
  missing_data: 'missing_data',
};

/** One `round_templates` row: department NULL = everyone (single_template). */
export interface PlannedRoundTemplate {
  department: RoundDepartment | null;
  template: CandidateTemplate;
}

/** One assignment row. */
export interface PlannedAssignment {
  employeeId: string;
  /** The employee's department now; it never changes afterwards (department snapshot). */
  departmentId: string;
  templateId: string;
  status: AssignmentStatus;
}

export interface RoundPlan {
  roundTemplates: PlannedRoundTemplate[];
  assignments: PlannedAssignment[];
}

/**
 * The rows a resolved round choice (3.8 `resolve`) creates, with no database:
 * - `round_templates`: single_template → one row, department NULL; by_department → one row per
 *   `ready` department (by code), with its template (the manager's choice where it had several).
 * - one assignment per recipient whose outcome adds them (`IN_ROUND_OUTCOMES`): department and
 *   template from the same resolution.
 * Call only when the resolution has no blockers.
 */
export function planRound(input: {
  mode: RoundMode;
  departments: readonly DepartmentPlan[];
  recipients: readonly ResolvedRecipient[];
}): RoundPlan {
  const assignments: PlannedAssignment[] = [];
  const seen = new Set<string>();
  for (const recipient of input.recipients) {
    const status = ASSIGNMENT_STATUS_OF[recipient.outcome];
    if (status === undefined) continue;
    const { employee, template } = recipient;
    if (!template) throw new Error('A recipient in the round has no template');
    if (seen.has(employee.id)) throw new Error('An employee is twice in the round');
    seen.add(employee.id);
    assignments.push({
      employeeId: employee.id,
      departmentId: employee.department.id,
      templateId: template.row.id,
      status,
    });
  }

  const ready = input.departments.filter(
    (entry): entry is DepartmentPlan & { template: CandidateTemplate } =>
      entry.status === 'ready' && entry.template !== null,
  );
  if (input.mode === 'single_template') {
    const [first] = ready;
    if (!first) throw new Error('single_template round without its template');
    return { roundTemplates: [{ department: null, template: first.template }], assignments };
  }
  return {
    roundTemplates: ready.map(({ department, template }) => ({ department, template })),
    assignments,
  };
}

/**
 * What must not change between the resolution and the template lock (3.9 re-check): name, file,
 * archived, latest, employer mode, linked departments and every position. `updated_at` is left
 * out: locking the template changes it.
 */
export function templateFingerprint(row: TemplateRow): string {
  return JSON.stringify({
    name: row.name,
    fileKey: row.fileKey,
    isArchived: row.isArchived,
    isLatest: row.isLatest,
    employerSignatureMode: row.employerSignatureMode,
    departments: row.departments.map(({ id }) => id).sort(),
    fields: row.fields,
  });
}
