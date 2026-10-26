import {
  allowedFillModes,
  EMAIL_CHOICE_KEY,
  EMAIL_CHOICES,
  hasOwnKey,
  TEMPLATE_FIELD_GROUPS,
  TEMPLATE_FIELD_TYPES,
  type TemplateFieldGroup,
  type TemplateFieldType,
  type TemplateFillMode,
  textLimitFor,
} from '@doc-signing/shared';
import { he } from '../../../i18n/he';
import { isolateLtr } from '../template-view';
import {
  type EditorBox,
  type EditorState,
  isPension,
  isSignature,
  mayFill,
  takesLabel,
} from './editor-state';

const text = he.templates.editor;

/** What a box's card shows, by its type and fill mode (FR-TPL-10, 3.20 rules). */
export interface CardControls {
  /** The fill modes to choose from; empty when the type has only one (or none). */
  fillModes: TemplateFillMode[];
  /** Only the six box types choose their key. */
  keyEditable: boolean;
  label: boolean;
  labelRequired: boolean;
  required: boolean;
  approval: boolean;
  /** The text limit's cap, or null when the box takes none. */
  maxLength: number | null;
  choices: boolean;
  dates: boolean;
  /** Signatures take a condition per position, every other type per box (FR-SGN-10). */
  conditionPerPosition: boolean;
  pension: boolean;
}

export function cardControls(box: Pick<EditorBox, 'fieldType' | 'fillMode'>): CardControls {
  const { fieldType } = box;
  const modes = allowedFillModes(fieldType).filter((mode) => mode !== null);
  const group = TEMPLATE_FIELD_GROUPS[fieldType];
  // A label is what the employee reads on the form: only a box she may fill in has one.
  const label = takesLabel(fieldType) && mayFill(box);
  return {
    fillModes: modes.length > 1 ? modes : [],
    keyEditable: !hasOwnKey(fieldType),
    label,
    labelRequired: label,
    required: group !== 'signature' && group !== 'email',
    approval: mayFill(box),
    maxLength: textLimitFor(fieldType, box.fillMode)?.max ?? null,
    choices: fieldType === 'select',
    dates: fieldType === 'date_input',
    conditionPerPosition: isSignature(fieldType),
    pension: isPension(fieldType),
  };
}

/** The "add" menu: every type, in the order of its group (FR-TPL-2). */
export const ADD_GROUPS: readonly { group: TemplateFieldGroup; types: TemplateFieldType[] }[] = (
  ['box', 'email', 'signature', 'system_fixed', 'system'] as const
).map((group) => ({
  group,
  types: TEMPLATE_FIELD_TYPES.filter((type) => TEMPLATE_FIELD_GROUPS[type] === group),
}));

/** A box by its Hebrew type, plus its key when the type can appear more than once. */
export function boxTitle(box: Pick<EditorBox, 'fieldType' | 'key'>): string {
  const type = he.templates.fieldTypes[box.fieldType];
  return hasOwnKey(box.fieldType) ? type : he.templates.boxName(type, isolateLtr(box.key));
}

export interface ConditionValue {
  value: string;
  label: string;
}

/** A box a condition may point to, with the values it can have. */
export interface ConditionTarget {
  key: string;
  name: string;
  values: ConditionValue[];
}

/**
 * The boxes a condition may test (FR-TPL-8): checkboxes and lists that have no condition of
 * their own, never the box itself, plus the email choice when both email boxes are there.
 */
export function conditionTargets(state: EditorState, forBoxUid: string): ConditionTarget[] {
  const targets: ConditionTarget[] = [];
  const seen = new Set<string>();
  for (const box of state.boxes) {
    if (box.uid === forBoxUid || box.showWhen !== null || seen.has(box.key)) continue;
    if (box.fieldType === 'checkbox') {
      targets.push({
        key: box.key,
        name: boxTitle(box),
        values: [
          { value: 'true', label: text.checked },
          { value: 'false', label: text.unchecked },
        ],
      });
    } else if (box.fieldType === 'select') {
      const choices = [...new Set(box.choices.map((choice) => choice.trim()))].filter(Boolean);
      targets.push({
        key: box.key,
        name: boxTitle(box),
        values: choices.map((choice) => ({ value: choice, label: choice })),
      });
    } else {
      continue;
    }
    seen.add(box.key);
  }
  const has = (type: TemplateFieldType) => state.boxes.some((box) => box.fieldType === type);
  if (has('email_input') && has('no_email_checkbox')) {
    targets.push({
      key: EMAIL_CHOICE_KEY,
      name: text.emailChoice,
      values: EMAIL_CHOICES.map((value) => ({ value, label: text.emailChoices[value] })),
    });
  }
  return targets;
}
