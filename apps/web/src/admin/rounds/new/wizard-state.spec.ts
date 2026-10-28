import { ROUND_MAX_EMPLOYEE_IDS } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { listItem } from '../../employees/employees.fixtures';
import { readyTemplate } from '../../templates/templates.fixtures';
import { DEPT_15, DEPT_19, OTHER_EMPLOYEE_ID, report, TEMPLATE_B_ID } from './rounds.fixtures';
import {
  canLeaveSummary,
  initialWizardState,
  nameProblem,
  pickedFrom,
  previewStatus,
  selectionBody,
  stepProblem,
  type WizardAction,
  wizardReducer,
  type WizardState,
} from './wizard-state';

const picked = pickedFrom(listItem);
const other = { ...picked, id: OTHER_EMPLOYEE_ID, employeeNumber: '9002' };

function run(...actions: WizardAction[]): WizardState {
  return actions.reduce(wizardReducer, initialWizardState());
}

const template: WizardAction = { type: 'template', templateId: readyTemplate.id };

describe('selectionBody', () => {
  it('is null until a template and some recipients are chosen', () => {
    expect(selectionBody(run())).toBeNull();
    expect(selectionBody(run(template))).toBeNull();
    expect(selectionBody(run({ type: 'all', all: true }))).toBeNull();
  });

  it.each([
    [
      'all employees',
      [{ type: 'all', all: true }],
      { all: true, departmentIds: [], employeeIds: [] },
    ],
    [
      'departments',
      [{ type: 'departments', departmentIds: [DEPT_15.id, DEPT_19.id] }],
      { all: false, departmentIds: [DEPT_15.id, DEPT_19.id], employeeIds: [] },
    ],
    [
      'hand-picked employees',
      [
        { type: 'addEmployee', employee: picked },
        { type: 'addEmployee', employee: other },
      ],
      { all: false, departmentIds: [], employeeIds: [picked.id, other.id] },
    ],
    [
      'one employee',
      [{ type: 'addEmployee', employee: picked }],
      { all: false, departmentIds: [], employeeIds: [picked.id] },
    ],
    [
      'everything combined',
      [
        { type: 'all', all: true },
        { type: 'departments', departmentIds: [DEPT_15.id] },
        { type: 'addEmployee', employee: other },
      ],
      { all: true, departmentIds: [DEPT_15.id], employeeIds: [other.id] },
    ],
  ] satisfies [string, WizardAction[], object][])(
    'single_template: %s',
    (_name, actions, recipients) => {
      expect(selectionBody(run(template, ...actions))).toEqual({
        mode: 'single_template',
        templateId: readyTemplate.id,
        recipients,
        alreadySigned: 'skip',
      });
    },
  );

  it('by_department: no templateId; the choices sorted by department id; send again', () => {
    const state = run(
      template,
      { type: 'mode', mode: 'by_department' },
      { type: 'departments', departmentIds: [DEPT_15.id] },
      { type: 'departmentChoice', departmentId: DEPT_15.id, templateId: TEMPLATE_B_ID },
      { type: 'departmentChoice', departmentId: DEPT_19.id, templateId: readyTemplate.id },
      { type: 'alreadySigned', choice: 'send_again' },
    );
    const choices = [
      { departmentId: DEPT_15.id, templateId: TEMPLATE_B_ID },
      { departmentId: DEPT_19.id, templateId: readyTemplate.id },
    ].sort((a, b) => (a.departmentId < b.departmentId ? -1 : 1));
    expect(selectionBody(state)).toEqual({
      mode: 'by_department',
      departmentTemplates: choices,
      recipients: { all: false, departmentIds: [DEPT_15.id], employeeIds: [] },
      alreadySigned: 'send_again',
    });
  });

  it('by_department without choices leaves departmentTemplates out', () => {
    const state = run({ type: 'mode', mode: 'by_department' }, { type: 'all', all: true });
    expect(selectionBody(state)).not.toHaveProperty('departmentTemplates');
  });
});

describe('employees', () => {
  it('each once, removable, up to the limit', () => {
    let state = run(
      { type: 'addEmployee', employee: picked },
      { type: 'addEmployee', employee: picked },
    );
    expect(state.employees).toHaveLength(1);
    state = wizardReducer(state, { type: 'removeEmployee', employeeId: picked.id });
    expect(state.employees).toHaveLength(0);

    const full = {
      ...initialWizardState(),
      employees: Array.from({ length: ROUND_MAX_EMPLOYEE_IDS }, (_, index) => ({
        ...picked,
        id: String(index),
      })),
    };
    expect(wizardReducer(full, { type: 'addEmployee', employee: other }).employees).toHaveLength(
      ROUND_MAX_EMPLOYEE_IDS,
    );
  });

  it('keeps only the fields shown: never the ID number or the email', () => {
    expect(
      Object.keys(pickedFrom({ ...listItem, idNumber: '000000018' } as typeof listItem)),
    ).toEqual([
      'id',
      'employeeNumber',
      'firstName',
      'lastName',
      'department',
      'emailStatus',
      'isActive',
    ]);
    expect(picked.department).toBe('15 - מחלקה לדוגמה א');
  });

  it('a preselected employee is added without counting as a change (no leave warning)', () => {
    const state = run({ type: 'preselect', employee: picked });
    expect(state.employees).toEqual([picked]);
    expect(state.touched).toBe(false);
    expect(run({ type: 'name', name: 'א' }).touched).toBe(true);
  });
});

describe('preview status', () => {
  const ready = run(template, { type: 'all', all: true });
  const body = selectionBody(ready);
  const previewed = wizardReducer(ready, {
    type: 'previewed',
    result: {
      body: body ?? { mode: 'single_template', recipients: {} },
      report: report(),
      receivedAt: new Date(),
    },
  });

  it('none → current → stale when the choice changes (skip / send again included)', () => {
    expect(previewStatus(ready)).toBe('none');
    expect(previewStatus(previewed)).toBe('current');
    expect(canLeaveSummary(previewed)).toBe(true);
    for (const action of [
      { type: 'alreadySigned', choice: 'send_again' },
      { type: 'addEmployee', employee: picked },
      { type: 'mode', mode: 'by_department' },
      { type: 'template', templateId: TEMPLATE_B_ID },
    ] satisfies WizardAction[]) {
      const changed = wizardReducer(previewed, action);
      expect(previewStatus(changed)).toBe('stale');
      expect(canLeaveSummary(changed)).toBe(false);
    }
  });

  it('the name or the step never makes it stale', () => {
    const named = wizardReducer(previewed, { type: 'name', name: 'סבב' });
    expect(previewStatus(wizardReducer(named, { type: 'goTo', step: 'name' }))).toBe('current');
  });

  it('blockers keep the summary closed', () => {
    const blocked = wizardReducer(ready, {
      type: 'previewed',
      result: {
        body: body ?? { mode: 'single_template', recipients: {} },
        report: report({ canCreate: false }),
        receivedAt: new Date(),
      },
    });
    expect(canLeaveSummary(blocked)).toBe(false);
  });
});

describe('step problems', () => {
  it('name: required, one line, at most 150 characters', () => {
    expect(nameProblem('')).toBe('nameRequired');
    expect(nameProblem('   ')).toBe('nameRequired');
    expect(nameProblem('שורה\nשנייה')).toBe('nameOneLine');
    expect(nameProblem('א'.repeat(151))).toBe('nameTooLong');
    expect(nameProblem(' חוזה שנתי ')).toBeNull();
  });

  it('document only in single_template; recipients need one choice', () => {
    expect(stepProblem(run(), 'document')).toBe('templateRequired');
    expect(stepProblem(run({ type: 'mode', mode: 'by_department' }), 'document')).toBeNull();
    expect(stepProblem(run(), 'recipients')).toBe('recipientsRequired');
    expect(stepProblem(run({ type: 'all', all: true }), 'recipients')).toBeNull();
  });
});
