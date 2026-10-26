import {
  allowedFillModes,
  formatDayIL,
  assignBoxKeys,
  hasOwnKey,
  PENSION_FIELD_TYPES,
  type PensionSource,
  type ShowWhen,
  SIGNING_DAY,
  TEMPLATE_FIELD_GROUPS,
  TEMPLATE_FOOTER_HEIGHT,
  type TemplateField,
  type TemplateFieldInput,
  type TemplateFieldType,
  type TemplateFillMode,
  textLimitFor,
} from '@doc-signing/shared';
import { parseDay } from '../../employees/employee-form';

/** The earliest or latest date of a date box: none, the signing day, or a typed DD/MM/YYYY day. */
export interface DateLimit {
  kind: 'none' | 'signing_day' | 'fixed';
  /** The typed day (DD/MM/YYYY), used when `kind` is `fixed`. */
  text: string;
}

/** One box (all positions of one key) as the editor holds it; numbers and dates as typed text. */
export interface EditorBox {
  /** Local id; stays the same while the key is renamed. */
  uid: string;
  fieldType: TemplateFieldType;
  key: string;
  fillMode: TemplateFillMode | null;
  /** The box's condition. Signatures keep theirs per position instead (FR-SGN-10). */
  showWhen: ShowWhen | null;
  isRequired: boolean;
  label: string;
  needsApproval: boolean;
  maxLength: string;
  choices: string[];
  minDate: DateLimit;
  maxDate: DateLimit;
}

export const POSITION_NUMBERS = ['page', 'x', 'y', 'width', 'height'] as const;
export type PositionNumber = (typeof POSITION_NUMBERS)[number];

export interface EditorPosition {
  uid: string;
  boxUid: string;
  page: string;
  x: string;
  y: string;
  width: string;
  height: string;
  /** Signatures only: this line's own condition (FR-SGN-10). */
  showWhen: ShowWhen | null;
}

/**
 * The unsaved template positions. `positions` keeps the stored order, so a save without a real
 * change sends an equal list (and never makes a version by accident). `boxes` are in the order
 * their first position appears. The pension source is one setting for all three pension types.
 */
export interface EditorState {
  boxes: EditorBox[];
  positions: EditorPosition[];
  pensionSource: PensionSource;
  /** Keys whose stored positions had different settings: the first position's now stand. */
  mixedKeys: string[];
}

export const isSignature = (type: TemplateFieldType) => TEMPLATE_FIELD_GROUPS[type] === 'signature';
export const isPension = (type: TemplateFieldType) =>
  (PENSION_FIELD_TYPES as readonly string[]).includes(type);

/** A typed number: "12.5" or "12,5" → 12.5; NaN when it isn't one. */
export function readNumber(text: string): number {
  const cleaned = text.trim().replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

const NO_DATE: DateLimit = { kind: 'none', text: '' };

function dateLimitOf(value: string | undefined): DateLimit {
  if (value === undefined) return NO_DATE;
  if (value === SIGNING_DAY) return { kind: 'signing_day', text: '' };
  return { kind: 'fixed', text: formatDayIL(value) };
}

/** The settings that must match on every position of one key (as `templateReadiness` checks). */
function settingsText(field: TemplateField): string {
  const { fieldType, fillMode, options, isRequired, label, needsApproval, showWhen } = field;
  return JSON.stringify([
    fieldType,
    fillMode,
    canonical(options),
    isRequired,
    label,
    needsApproval,
    isSignature(fieldType) ? null : canonical(showWhen),
  ]);
}

/** JSON with sorted object keys, so equal settings give equal text. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([name, item]) => `${JSON.stringify(name)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function boxFromField(field: TemplateField, uid: string): EditorBox {
  const options = field.options ?? {};
  return {
    uid,
    fieldType: field.fieldType,
    key: field.key,
    fillMode: field.fillMode,
    showWhen: isSignature(field.fieldType) ? null : field.showWhen,
    isRequired: field.isRequired,
    label: field.label ?? '',
    needsApproval: field.needsApproval,
    maxLength: options.maxLength === undefined ? '' : String(options.maxLength),
    choices: options.choices ?? [],
    minDate: dateLimitOf(options.minDate),
    maxDate: dateLimitOf(options.maxDate),
  };
}

/** The stored positions → editor state, one box per key (FR-TPL-10). */
export function stateFromFields(fields: readonly TemplateField[]): EditorState {
  const boxes: EditorBox[] = [];
  const firstOf = new Map<string, { box: EditorBox; settings: string }>();
  const mixedKeys: string[] = [];
  const positions = fields.map((field): EditorPosition => {
    let entry = firstOf.get(field.key);
    if (!entry) {
      entry = { box: boxFromField(field, `box-${field.key}`), settings: settingsText(field) };
      firstOf.set(field.key, entry);
      boxes.push(entry.box);
    } else if (entry.settings !== settingsText(field) && !mixedKeys.includes(field.key)) {
      mixedKeys.push(field.key);
    }
    return {
      uid: field.id,
      boxUid: entry.box.uid,
      page: String(field.page),
      x: String(field.x),
      y: String(field.y),
      width: String(field.width),
      height: String(field.height),
      showWhen: isSignature(field.fieldType) ? field.showWhen : null,
    };
  });
  const pension = fields.find(({ fieldType }) => isPension(fieldType));
  return {
    boxes,
    positions,
    pensionSource: pension?.options?.pensionSource ?? 'a_then_b',
    mixedKeys,
  };
}

/** A new position's size in points, by what is drawn there. */
function defaultSize(type: TemplateFieldType): { width: number; height: number } {
  if (['checkbox', 'no_email_checkbox', 'pension_has_fund', 'pension_no_fund'].includes(type)) {
    return { width: 12, height: 12 };
  }
  if (isSignature(type) || type === 'drawing') return { width: 150, height: 40 };
  if (type === 'long_text') return { width: 250, height: 60 };
  return { width: 150, height: 20 };
}

let uidCounter = 0;
const newUid = (prefix: string) => {
  uidCounter += 1;
  return `${prefix}-new-${String(uidCounter)}`;
};

/** A new position: one row lower than the box's last one, or near the top of page 1. */
function newPosition(state: EditorState, box: EditorBox): EditorPosition {
  const last = [...state.positions].reverse().find(({ boxUid }) => boxUid === box.uid);
  const size = defaultSize(box.fieldType);
  const lastY = last ? readNumber(last.y) : Number.NaN;
  const y = Number.isNaN(lastY) ? 760 - 30 * state.positions.length : lastY - 30;
  return {
    uid: newUid('pos'),
    boxUid: box.uid,
    page: last?.page ?? '1',
    x: last?.x ?? '50',
    y: String(Math.max(TEMPLATE_FOOTER_HEIGHT + 4, y)),
    width: last?.width ?? String(size.width),
    height: last?.height ?? String(size.height),
    showWhen: null,
  };
}

/**
 * Adds a box of this type with one position. A type with its own key that is already there gets
 * one more position instead (one box per key). A box type's key is the next free `box_<n>`.
 * Returns the state and the box that got the position.
 */
export function addBox(
  state: EditorState,
  fieldType: TemplateFieldType,
): { state: EditorState; boxUid: string } {
  const existing = hasOwnKey(fieldType)
    ? state.boxes.find((box) => box.fieldType === fieldType)
    : undefined;
  if (existing) return { state: addPosition(state, existing.uid), boxUid: existing.uid };

  const keys = [...state.boxes.map(({ key }) => ({ key })), { key: null }];
  const key = hasOwnKey(fieldType) ? fieldType : (assignBoxKeys(keys).at(-1)?.key ?? 'box_1');
  const fillMode = allowedFillModes(fieldType)[0] ?? null;
  const limit = textLimitFor(fieldType, fillMode);
  const box: EditorBox = {
    uid: newUid('box'),
    fieldType,
    key,
    fillMode,
    showWhen: null,
    isRequired: true,
    label: '',
    needsApproval: false,
    maxLength: limit ? String(limit.default) : '',
    choices: [],
    minDate: NO_DATE,
    maxDate: NO_DATE,
  };
  const withBox = { ...state, boxes: [...state.boxes, box] };
  return {
    state: { ...withBox, positions: [...state.positions, newPosition(withBox, box)] },
    boxUid: box.uid,
  };
}

export function addPosition(state: EditorState, boxUid: string): EditorState {
  const box = state.boxes.find(({ uid }) => uid === boxUid);
  if (!box) return state;
  return { ...state, positions: [...state.positions, newPosition(state, box)] };
}

/** Removes one position; the box's last one is removed with the box (`removeBox`). */
export function removePosition(state: EditorState, positionUid: string): EditorState {
  const position = state.positions.find(({ uid }) => uid === positionUid);
  if (!position) return state;
  const rest = state.positions.filter(({ uid }) => uid !== positionUid);
  if (!rest.some(({ boxUid }) => boxUid === position.boxUid)) {
    return removeBox(state, position.boxUid);
  }
  return { ...state, positions: rest };
}

/** Removes a box and its positions. A condition still pointing to it shows as a "ready" reason. */
export function removeBox(state: EditorState, boxUid: string): EditorState {
  return {
    ...state,
    boxes: state.boxes.filter(({ uid }) => uid !== boxUid),
    positions: state.positions.filter((position) => position.boxUid !== boxUid),
  };
}

export type BoxChange = Partial<Omit<EditorBox, 'uid' | 'fieldType' | 'key'>>;

export function updateBox(state: EditorState, boxUid: string, change: BoxChange): EditorState {
  return {
    ...state,
    boxes: state.boxes.map((box) => {
      if (box.uid !== boxUid) return box;
      const next = { ...box, ...change };
      // A text limit that starts to apply (a new fill mode) starts at its default.
      const limit = textLimitFor(box.fieldType, next.fillMode);
      if (limit && next.maxLength.trim() === '') next.maxLength = String(limit.default);
      return next;
    }),
  };
}

export type PositionChange = Partial<Pick<EditorPosition, PositionNumber | 'showWhen'>>;

export function updatePosition(
  state: EditorState,
  positionUid: string,
  change: PositionChange,
): EditorState {
  return {
    ...state,
    positions: state.positions.map((position) =>
      position.uid === positionUid ? { ...position, ...change } : position,
    ),
  };
}

/**
 * A box type's new key. Conditions that pointed to the old key follow it, unless another box
 * still has the old key.
 */
export function renameKey(state: EditorState, boxUid: string, key: string): EditorState {
  const box = state.boxes.find(({ uid }) => uid === boxUid);
  if (!box || hasOwnKey(box.fieldType)) return state;
  const old = box.key;
  const oldStillUsed = state.boxes.some((other) => other.uid !== boxUid && other.key === old);
  const follow = (condition: ShowWhen | null) =>
    condition && !oldStillUsed && condition.key === old ? { ...condition, key } : condition;
  return {
    ...state,
    boxes: state.boxes.map((other) =>
      other.uid === boxUid ? { ...other, key } : { ...other, showWhen: follow(other.showWhen) },
    ),
    positions: state.positions.map((position) => ({
      ...position,
      showWhen: follow(position.showWhen),
    })),
  };
}

export function setPensionSource(state: EditorState, pensionSource: PensionSource): EditorState {
  return { ...state, pensionSource };
}

const readText = (text: string): number | string => {
  const value = readNumber(text);
  return Number.isNaN(value) ? text : value;
};

function dateValue(limit: DateLimit): string | undefined {
  if (limit.kind === 'none') return undefined;
  if (limit.kind === 'signing_day') return SIGNING_DAY;
  // A day that can't be read is sent as typed: the schema refuses it, and the check names it.
  return parseDay(limit.text) ?? limit.text;
}

/** The limits a box sends: only the ones its type and fill mode take (FR-TPL-5, FR-TPL-10). */
function optionsOf(box: EditorBox, pensionSource: PensionSource): Record<string, unknown> | null {
  if (isPension(box.fieldType)) return { pensionSource };
  if (textLimitFor(box.fieldType, box.fillMode)) {
    return box.maxLength.trim() === '' ? null : { maxLength: readText(box.maxLength) };
  }
  if (box.fieldType === 'select') return { choices: box.choices };
  if (box.fieldType === 'date_input') {
    const minDate = dateValue(box.minDate);
    const maxDate = dateValue(box.maxDate);
    if (minDate === undefined && maxDate === undefined) return null;
    return {
      ...(minDate !== undefined && { minDate }),
      ...(maxDate !== undefined && { maxDate }),
    };
  }
  return null;
}

/** May the employee give this box a value (her own box, or a system value she may fill in)? */
export const mayFill = (box: Pick<EditorBox, 'fillMode'>) =>
  box.fillMode === 'employee' || box.fillMode === 'system_then_employee';

/** Does the box have a label the employee reads (not signatures, not the fixed email pair)? */
export function takesLabel(type: TemplateFieldType): boolean {
  const group = TEMPLATE_FIELD_GROUPS[type];
  return group !== 'signature' && group !== 'email';
}

/**
 * The `fields` list for PATCH, in the stored order, each position with its box's settings. Not
 * yet checked: numbers that can't be read are sent as typed, so the shared schema names them.
 */
export function fieldsBody(state: EditorState): Record<string, unknown>[] {
  const byUid = new Map(state.boxes.map((box) => [box.uid, box]));
  return state.positions.flatMap((position) => {
    const box = byUid.get(position.boxUid);
    if (!box) return [];
    const signature = isSignature(box.fieldType);
    const options = optionsOf(box, state.pensionSource);
    const label = box.label.trim();
    return [
      {
        fieldType: box.fieldType,
        page: readText(position.page),
        x: readText(position.x),
        y: readText(position.y),
        width: readText(position.width),
        height: readText(position.height),
        key: box.key,
        fillMode: signature ? null : box.fillMode,
        showWhen: signature ? position.showWhen : box.showWhen,
        options,
        isRequired: signature || TEMPLATE_FIELD_GROUPS[box.fieldType] === 'email' || box.isRequired,
        label: takesLabel(box.fieldType) && label !== '' ? label : null,
        needsApproval: mayFill(box) && box.needsApproval,
      },
    ];
  });
}

const COMPARED = [
  'fieldType',
  'key',
  'fillMode',
  'showWhen',
  'options',
  'isRequired',
  'label',
  'needsApproval',
  'page',
  'x',
  'y',
  'width',
  'height',
] as const satisfies readonly (keyof TemplateFieldInput)[];

const comparable = (fields: readonly Pick<TemplateFieldInput, (typeof COMPARED)[number]>[]) =>
  canonical(fields.map((field) => COMPARED.map((name) => field[name])));

/** The checked list says the same as what is stored: nothing to save. */
export function sameAsStored(
  checked: readonly TemplateFieldInput[],
  stored: readonly TemplateField[],
): boolean {
  return comparable(checked) === comparable(stored);
}
