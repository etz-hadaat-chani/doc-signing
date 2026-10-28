import { ROUND_MAX_EMPLOYEE_IDS } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { listItem } from '../../employees/employees.fixtures';
import { readyTemplate } from '../../templates/templates.fixtures';
import {
  byDepartmentReport,
  DEPT_15,
  DEPT_19,
  OTHER_EMPLOYEE_ID,
  report,
  TEMPLATE_B_ID,
} from './rounds.fixtures';
import {
  canLeaveSummary,
  createBody,
  guardsLeaving,
  initialWizardState,
  nameProblem,
  pickedFrom,
  previewStatus,
  previewTemplateId,
  previewTemplates,
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

describe('part B: settings, draft and send', () => {
  const SETTINGS = {
    remindersEnabled: true,
    reminderIntervalDays: '3',
    limitReminders: false,
    maxReminders: '',
    linkExpiryDays: '60',
  };
  const ROUND_SETTINGS = {
    remindersEnabled: true,
    reminderIntervalDays: 3,
    maxReminders: null,
    linkExpiryDays: 60,
  };

  function previewed(...actions: WizardAction[]): WizardState {
    const state = run(
      { type: 'name', name: 'חוזה שנתי' },
      template,
      { type: 'all', all: true },
      ...actions,
    );
    const body = selectionBody(state);
    if (!body) throw new Error('no body');
    return wizardReducer(state, {
      type: 'previewed',
      result: { body, report: report(), receivedAt: new Date() },
    });
  }

  it('the create body is the previewed selection + name + all four settings', () => {
    const state = previewed();
    expect(createBody(state, ROUND_SETTINGS)).toEqual({
      ...state.preview?.body,
      name: 'חוזה שנתי',
      settings: ROUND_SETTINGS,
    });
    expect(createBody(run(), ROUND_SETTINGS)).toBeNull();
  });

  it('the loaded defaults never replace what the manager typed', () => {
    let state = run({ type: 'settingsLoaded', values: SETTINGS });
    expect(state.touched).toBe(false);
    state = wizardReducer(state, {
      type: 'settings',
      values: { ...SETTINGS, linkExpiryDays: '30' },
    });
    state = wizardReducer(state, { type: 'settingsLoaded', values: SETTINGS });
    expect(state.settings?.linkExpiryDays).toBe('30');
    expect(state.touched).toBe(true);
  });

  it('settings do not make the preview stale', () => {
    const state = wizardReducer(previewed(), { type: 'settings', values: SETTINGS });
    expect(previewStatus(state)).toBe('current');
  });

  it('once the draft exists, nothing it was made from can change', () => {
    const state = wizardReducer(previewed(), { type: 'created', roundId: OTHER_EMPLOYEE_ID });
    for (const action of [
      { type: 'name', name: 'אחר' },
      { type: 'all', all: false },
      { type: 'alreadySigned', choice: 'send_again' },
      { type: 'settings', values: SETTINGS },
    ] satisfies WizardAction[]) {
      expect(wizardReducer(state, action)).toBe(state);
    }
    const cancelled = wizardReducer(state, { type: 'draftCancelled' });
    expect(cancelled.roundId).toBeNull();
    expect(wizardReducer(cancelled, { type: 'name', name: 'אחר' }).name).toBe('אחר');
  });

  it('guards leaving while something is entered or a draft is unsent, not after the send', () => {
    expect(guardsLeaving(run())).toBe(false);
    expect(guardsLeaving(run({ type: 'preselect', employee: picked }))).toBe(false);
    expect(guardsLeaving(run({ type: 'created', roundId: OTHER_EMPLOYEE_ID }))).toBe(true);
    const state = previewed();
    expect(guardsLeaving(state)).toBe(true);
    const sent = wizardReducer(state, { type: 'sent', sent: SENT });
    expect(guardsLeaving(sent)).toBe(false);
    expect(wizardReducer(sent, { type: 'reset' })).toEqual(initialWizardState());
  });

  it('the preview offers the chosen template, or each ready department template once', () => {
    const single = previewed();
    expect(previewTemplates(single).map(({ id }) => id)).toEqual([readyTemplate.id]);
    expect(previewTemplateId(single)).toBe(readyTemplate.id);

    const base = byDepartmentReport();
    const ready = base.departments.map((department) => ({
      ...department,
      status: 'ready' as const,
      template: department.options[0] ?? department.template,
    }));
    let state = run({ type: 'mode', mode: 'by_department' }, { type: 'all', all: true });
    const body = selectionBody(state);
    if (!body) throw new Error('no body');
    state = wizardReducer(state, {
      type: 'previewed',
      result: { body, report: { ...base, departments: ready }, receivedAt: new Date() },
    });
    const templates = previewTemplates(state);
    expect(new Set(templates.map(({ id }) => id)).size).toBe(templates.length);
    expect(templates.flatMap(({ departments }) => departments).sort()).toEqual(
      ready
        .filter(({ template: ref }) => ref !== null)
        .map(({ label }) => label)
        .sort(),
    );
    const last = templates.at(-1)?.id ?? '';
    expect(
      previewTemplateId(wizardReducer(state, { type: 'previewTemplate', templateId: last })),
    ).toBe(last);
    // A pick that is no longer offered falls back to the first.
    expect(
      previewTemplateId(wizardReducer(state, { type: 'previewTemplate', templateId: 'gone' })),
    ).toBe(templates[0]?.id);
  });
});

const SENT = {
  id: OTHER_EMPLOYEE_ID,
  status: 'sending' as const,
  sentAt: '2026-10-28T08:00:00.000Z',
  linkExpiresAt: '2026-12-27T08:00:00.000Z',
  counts: { queued: 1, noEmail: 0, missingData: 0, cancelledInactive: 0 },
  outdatedTemplateIds: [],
  textWarnings: { total: 0, truncated: false, items: [] },
};
