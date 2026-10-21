import { describe, expect, it } from 'vitest';
import {
  candidateTemplate,
  DEPT_15,
  DEPT_19,
  DEPT_61,
  recipientEmployee,
} from '../../../test/fixtures/rounds.js';
import type { RecipientOutcome, ResolvedRecipient } from './recipient-outcome.js';
import { planRound, templateFingerprint } from './round-plan.js';
import type { CandidateTemplate, DepartmentPlan, RoundDepartment } from './round-templates.js';

const A = candidateTemplate({ id: 1, departments: [DEPT_15, DEPT_19] });
const B = candidateTemplate({ id: 2, departments: [DEPT_15] });

function recipient(
  n: number,
  outcome: RecipientOutcome,
  options: { department?: RoundDepartment; template?: CandidateTemplate | null } = {},
): ResolvedRecipient {
  const template = options.template === undefined ? A : options.template;
  return {
    employee: recipientEmployee({ n, department: options.department ?? DEPT_15 }),
    pickedByHand: false,
    template,
    outcome,
    signedBefore: null,
    openElsewhere: null,
    missing: outcome === 'missing_data' ? [{ key: 'address', name: 'כתובת' }] : [],
    textWarnings: [],
    noEmailReason: outcome === 'no_email' ? 'missing' : null,
    fieldValues: null,
  };
}

const ready = (department: RoundDepartment, template: CandidateTemplate): DepartmentPlan => ({
  department,
  status: 'ready',
  template,
  options: [],
  notOffered: [],
});

describe('planRound', () => {
  it('gives each outcome that adds the employee its status, and leaves out the rest', () => {
    const plan = planRound({
      mode: 'single_template',
      departments: [ready(DEPT_15, A)],
      recipients: [
        recipient(1, 'email'),
        recipient(2, 'no_email'),
        recipient(3, 'missing_data'),
        recipient(4, 'already_signed'),
        recipient(5, 'already_open'),
        recipient(6, 'inactive', { template: null }),
      ],
    });
    expect(plan.assignments.map(({ status }) => status)).toEqual([
      'pending',
      'no_email',
      'missing_data',
    ]);
  });

  it('takes department and template from the resolution (the department at creation)', () => {
    const plan = planRound({
      mode: 'by_department',
      departments: [ready(DEPT_15, B), ready(DEPT_19, A)],
      recipients: [
        recipient(1, 'email', { department: DEPT_15, template: B }),
        recipient(2, 'email', { department: DEPT_19, template: A }),
      ],
    });
    expect(plan.assignments).toEqual([
      {
        employeeId: recipientEmployee({ n: 1 }).id,
        departmentId: DEPT_15.id,
        templateId: B.row.id,
        status: 'pending',
      },
      {
        employeeId: recipientEmployee({ n: 2 }).id,
        departmentId: DEPT_19.id,
        templateId: A.row.id,
        status: 'pending',
      },
    ]);
  });

  it('single_template: one round template for everyone, department NULL', () => {
    const plan = planRound({
      mode: 'single_template',
      departments: [ready(DEPT_15, A), ready(DEPT_19, A)],
      recipients: [recipient(1, 'email')],
    });
    expect(plan.roundTemplates).toEqual([{ department: null, template: A }]);
  });

  it('by_department: one round template per ready department, the chosen one where there were several', () => {
    const plan = planRound({
      mode: 'by_department',
      departments: [
        { ...ready(DEPT_15, B), options: [A, B] },
        ready(DEPT_19, A),
        { department: DEPT_61, status: 'no_template', template: null, options: [], notOffered: [] },
      ],
      recipients: [recipient(1, 'email', { template: B })],
    });
    expect(plan.roundTemplates).toEqual([
      { department: DEPT_15, template: B },
      { department: DEPT_19, template: A },
    ]);
  });

  it('never adds an employee twice', () => {
    expect(() =>
      planRound({
        mode: 'single_template',
        departments: [ready(DEPT_15, A)],
        recipients: [recipient(1, 'email'), recipient(1, 'no_email')],
      }),
    ).toThrow('twice');
  });
});

describe('templateFingerprint', () => {
  it('changes with an archive, a new version, departments or positions, not with updated_at', () => {
    const base = templateFingerprint(A.row);
    expect(templateFingerprint({ ...A.row, updatedAt: new Date() })).toBe(base);
    expect(templateFingerprint({ ...A.row, isArchived: true })).not.toBe(base);
    expect(templateFingerprint({ ...A.row, isLatest: false })).not.toBe(base);
    expect(templateFingerprint({ ...A.row, departments: [DEPT_15] })).not.toBe(base);
    expect(templateFingerprint({ ...A.row, name: 'חוזה אחר' })).not.toBe(base);
    expect(templateFingerprint({ ...A.row, departments: [DEPT_19, DEPT_15] })).toBe(base);
  });
});
