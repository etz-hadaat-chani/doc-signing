import {
  type AlreadySignedChoice,
  type EmailStatus,
  type EmployeeListItem,
  formatDepartment,
  type RecipientsPreviewReport,
  ROUND_MAX_DEPARTMENT_IDS,
  ROUND_MAX_EMPLOYEE_IDS,
  type RoundMode,
  roundNameSchema,
} from '@doc-signing/shared';
import type { RoundSelectionBody } from '../rounds.api';

/** The wizard's steps in order (PRD A5, Flow 3). */
export const WIZARD_STEPS = [
  'name',
  'document',
  'recipients',
  'summary',
  'settings',
  'preview',
  'send',
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/**
 * A hand-picked employee as the wizard shows them: number, name, department and email status.
 * Never the ID number or the email address.
 */
export interface PickedEmployee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  /** "15 - name". */
  department: string;
  emailStatus: EmailStatus;
  isActive: boolean;
}

/** Only the fields the wizard shows, from a list row or the employee card. */
export function pickedFrom(employee: EmployeeListItem): PickedEmployee {
  return {
    id: employee.id,
    employeeNumber: employee.employeeNumber,
    firstName: employee.firstName,
    lastName: employee.lastName,
    department: formatDepartment(employee.department.code, employee.department.name),
    emailStatus: employee.emailStatus,
    isActive: employee.isActive,
  };
}

/** A recipient preview with the exact body it was asked with. */
export interface PreviewResult {
  body: RoundSelectionBody;
  report: RecipientsPreviewReport;
  receivedAt: Date;
}

/** Everything the manager entered. Kept in component memory only (no address, no storage). */
export interface WizardState {
  step: WizardStep;
  /** The manager changed something (the leave warning); a preselected employee alone doesn't. */
  touched: boolean;
  name: string;
  mode: RoundMode;
  /** single_template: the chosen template. */
  templateId: string | null;
  /** by_department: the manager's template for a department with several, by department id. */
  departmentChoices: Readonly<Record<string, string>>;
  all: boolean;
  /** In code order (DepartmentPicker keeps them so). */
  departmentIds: readonly string[];
  /** In the order picked. */
  employees: readonly PickedEmployee[];
  alreadySigned: AlreadySignedChoice;
  preview: PreviewResult | null;
}

export type WizardAction =
  | { type: 'name'; name: string }
  | { type: 'mode'; mode: RoundMode }
  | { type: 'template'; templateId: string }
  | { type: 'all'; all: boolean }
  | { type: 'departments'; departmentIds: readonly string[] }
  | { type: 'addEmployee'; employee: PickedEmployee }
  | { type: 'removeEmployee'; employeeId: string }
  /** The employee the card's "send document" shortcut opened the wizard with. */
  | { type: 'preselect'; employee: PickedEmployee }
  | { type: 'departmentChoice'; departmentId: string; templateId: string }
  | { type: 'alreadySigned'; choice: AlreadySignedChoice }
  | { type: 'previewed'; result: PreviewResult }
  | { type: 'goTo'; step: WizardStep };

export function initialWizardState(): WizardState {
  return {
    step: 'name',
    touched: false,
    name: '',
    mode: 'single_template',
    templateId: null,
    departmentChoices: {},
    all: false,
    departmentIds: [],
    employees: [],
    alreadySigned: 'skip',
    preview: null,
  };
}

function withEmployee(state: WizardState, employee: PickedEmployee): WizardState {
  if (state.employees.some(({ id }) => id === employee.id)) return state;
  if (state.employees.length >= ROUND_MAX_EMPLOYEE_IDS) return state;
  return { ...state, employees: [...state.employees, employee] };
}

/** Changes made by the manager; the preview, the step and a preselected employee are not. */
function edit(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'name':
      return { ...state, name: action.name };
    case 'mode':
      return { ...state, mode: action.mode };
    case 'template':
      return { ...state, templateId: action.templateId };
    case 'all':
      return { ...state, all: action.all };
    case 'departments':
      return { ...state, departmentIds: action.departmentIds.slice(0, ROUND_MAX_DEPARTMENT_IDS) };
    case 'addEmployee':
      return withEmployee(state, action.employee);
    case 'removeEmployee':
      return { ...state, employees: state.employees.filter(({ id }) => id !== action.employeeId) };
    case 'departmentChoice':
      return {
        ...state,
        departmentChoices: { ...state.departmentChoices, [action.departmentId]: action.templateId },
      };
    case 'alreadySigned':
      return { ...state, alreadySigned: action.choice };
    default:
      return state;
  }
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'preselect':
      return withEmployee(state, action.employee);
    case 'previewed':
      return { ...state, preview: action.result };
    case 'goTo':
      return { ...state, step: action.step };
    default:
      return { ...edit(state, action), touched: true };
  }
}

export const hasRecipients = (state: WizardState) =>
  state.all || state.departmentIds.length > 0 || state.employees.length > 0;

/**
 * The body of the recipient preview, and of the round's creation (with a name and settings):
 * null until a template (single_template) and some recipients are chosen. Fields always in the
 * same order, so two bodies compare as text.
 */
export function selectionBody(state: WizardState): RoundSelectionBody | null {
  if (!hasRecipients(state)) return null;
  const recipients = {
    all: state.all,
    departmentIds: [...state.departmentIds],
    employeeIds: state.employees.map(({ id }) => id),
  };
  if (state.mode === 'single_template') {
    if (state.templateId === null) return null;
    return {
      mode: state.mode,
      templateId: state.templateId,
      recipients,
      alreadySigned: state.alreadySigned,
    };
  }
  const choices = Object.entries(state.departmentChoices)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([departmentId, templateId]) => ({ departmentId, templateId }));
  return {
    mode: state.mode,
    ...(choices.length > 0 && { departmentTemplates: choices }),
    recipients,
    alreadySigned: state.alreadySigned,
  };
}

const sameBody = (a: RoundSelectionBody | null, b: RoundSelectionBody | null) =>
  JSON.stringify(a) === JSON.stringify(b);

/** `none` before the first preview; `stale` when the choice changed since. */
export type PreviewStatus = 'none' | 'stale' | 'current';

export function previewStatus(state: WizardState): PreviewStatus {
  if (!state.preview) return 'none';
  return sameBody(state.preview.body, selectionBody(state)) ? 'current' : 'stale';
}

/** The summary may be left only with a current preview that has no blockers. */
export const canLeaveSummary = (state: WizardState) =>
  previewStatus(state) === 'current' && state.preview?.report.canCreate === true;

export type StepProblem =
  'nameRequired' | 'nameTooLong' | 'nameOneLine' | 'templateRequired' | 'recipientsRequired';

export function nameProblem(name: string): StepProblem | null {
  const result = roundNameSchema.safeParse(name);
  if (result.success) return null;
  const trimmed = name.trim();
  if (trimmed === '') return 'nameRequired';
  if (/[\r\n]/.test(trimmed)) return 'nameOneLine';
  return 'nameTooLong';
}

/** What stops "next" on a step (shown under the field after the first try). */
export function stepProblem(state: WizardState, step: WizardStep): StepProblem | null {
  switch (step) {
    case 'name':
      return nameProblem(state.name);
    case 'document':
      return state.mode === 'single_template' && state.templateId === null
        ? 'templateRequired'
        : null;
    case 'recipients':
      return hasRecipients(state) ? null : 'recipientsRequired';
    default:
      return null;
  }
}
