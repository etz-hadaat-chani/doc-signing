import {
  errorMessage,
  fieldErrorSchema,
  isErrorCode,
  TEMPLATE_FIELD_LABEL_MAX_LENGTH,
  TEMPLATE_MAX_FIELDS,
  type TemplateFieldInput,
  type TemplateItem,
  type TemplateNotReadyReason,
  templateReadiness,
  templateUpdateSchema,
} from '@doc-signing/shared';
import { z } from 'zod';
import { isApiRequestError } from '../../../api/api-error';
import { he } from '../../../i18n/he';
import { parseDay } from '../../employees/employee-form';
import {
  type EditorState,
  fieldsBody,
  isSignature,
  POSITION_NUMBERS,
  type PositionNumber,
  readNumber,
} from './editor-state';
import type { PageSize } from '../../../pdf/page-fit';
import { inFooter, pageProblem } from './pdf-geometry';

const text = he.templates.editor;

export const BOX_PROPS = [
  'key',
  'label',
  'fillMode',
  'maxLength',
  'choices',
  'minDate',
  'maxDate',
  'pensionSource',
  'needsApproval',
  'showWhen',
  'general',
] as const;
export type BoxProp = (typeof BOX_PROPS)[number];
export type PositionProp = PositionNumber | 'showWhen' | 'general';

/** Problems by box and position (local uids), the first one per field, in Hebrew. */
export interface EditorErrors {
  boxes: Record<string, Partial<Record<BoxProp, string>>>;
  positions: Record<string, Partial<Record<PositionProp, string>>>;
  /** Not tied to one box (e.g. more than 40 positions). */
  general: string | null;
}

export const noErrors = (): EditorErrors => ({ boxes: {}, positions: {}, general: null });

export function hasErrors(errors: EditorErrors): boolean {
  return (
    errors.general !== null ||
    Object.values(errors.boxes).some((props) => Object.keys(props).length > 0) ||
    Object.values(errors.positions).some((props) => Object.keys(props).length > 0)
  );
}

/** The input id of a box's or position's field, so the first error can take the focus. */
export const boxFieldId = (uid: string, prop: BoxProp) => `box-${uid}-${prop}`;
/** A box card's heading: an outline on the PDF brings it into view. */
export const boxCardId = (uid: string) => `box-card-${uid}`;
export const positionFieldId = (uid: string, prop: PositionProp) => `pos-${uid}-${prop}`;

/** The ids of every marked field, boxes first, in screen order. */
export function errorFieldIds(errors: EditorErrors, state: EditorState): string[] {
  const ids: string[] = [];
  for (const box of state.boxes) {
    for (const prop of BOX_PROPS) {
      if (errors.boxes[box.uid]?.[prop]) ids.push(boxFieldId(box.uid, prop));
    }
    for (const position of state.positions) {
      if (position.boxUid !== box.uid) continue;
      for (const prop of [...POSITION_NUMBERS, 'showWhen', 'general'] as const) {
        if (errors.positions[position.uid]?.[prop]) ids.push(positionFieldId(position.uid, prop));
      }
    }
  }
  return ids;
}

const isPositionNumber = (value: unknown): value is PositionNumber =>
  (POSITION_NUMBERS as readonly unknown[]).includes(value);

/** A number's problem in Hebrew, by field and kind. */
function numberText(prop: PositionNumber, typed: string, issue: z.core.$ZodIssue): string {
  if (Number.isNaN(readNumber(typed))) return text.notNumber;
  if (prop === 'page') return text.pageNumber;
  if (issue.code === 'too_big') return text.numberTooBig;
  if (prop === 'width' || prop === 'height') return text.sizePositive;
  return text.notNegative;
}

function settingText(prop: BoxProp, issue: z.core.$ZodIssue): string {
  if (isErrorCode(issue.message)) return errorMessage(issue.message);
  if (prop === 'label') return text.labelTooLong(TEMPLATE_FIELD_LABEL_MAX_LENGTH);
  if (prop === 'choices') return errorMessage('TEMPLATE_FIELD_LIMIT_INVALID');
  return errorMessage('VALIDATION_FAILED');
}

/** A path inside a box's settings → the field on its card. */
function boxPropOf(path: readonly PropertyKey[]): BoxProp {
  const [prop, inner] = path;
  if (prop === 'options') {
    if (inner === 'maxLength' || inner === 'choices' || inner === 'minDate') return inner;
    if (inner === 'maxDate' || inner === 'pensionSource') return inner;
    return 'general';
  }
  if (prop === 'key' || prop === 'label' || prop === 'fillMode' || prop === 'showWhen') return prop;
  if (prop === 'needsApproval') return prop;
  return 'general';
}

/** Puts a problem at index `index` of the sent list on its position or its box (first wins). */
function place(
  errors: EditorErrors,
  state: EditorState,
  index: number,
  path: readonly PropertyKey[],
  message: (prop: BoxProp | PositionProp) => string,
) {
  const position = state.positions[index];
  const box = state.boxes.find(({ uid }) => uid === position?.boxUid);
  if (!position || !box) {
    errors.general ??= errorMessage('VALIDATION_FAILED');
    return;
  }
  const [prop] = path;
  if (isPositionNumber(prop) || (prop === 'showWhen' && isSignature(box.fieldType))) {
    const props = (errors.positions[position.uid] ??= {});
    props[prop] ??= message(prop);
    return;
  }
  const boxProp = boxPropOf(path);
  const props = (errors.boxes[box.uid] ??= {});
  props[boxProp] ??= message(boxProp);
}

export interface PdfFacts {
  /** The page sizes pdf.js read, or null while the PDF isn't loaded. */
  pages: readonly PageSize[] | null;
}

export interface EditorCheck {
  /** The checked list, ready to send; null while anything blocks the save. */
  fields: TemplateFieldInput[] | null;
  errors: EditorErrors;
  /** Positions that start in the footer strip (a "ready" reason, not a blocker). */
  inFooter: Set<string>;
  /** The live "ready" check on the unsaved list, or null when it can't be read yet. */
  readiness: TemplateNotReadyReason[] | null;
  /** The list as checked by the schema (also when other checks block it), for box names. */
  parsed: TemplateFieldInput[] | null;
}

/**
 * The whole unsaved list through the server's own schema (`templateUpdateSchema`), each problem
 * mapped to its box or position, plus what the screen can check itself: unique keys, readable
 * fixed dates, the page sizes from pdf.js. Then the live "ready" check (FR-TPL-8).
 */
export function checkEditor(
  state: EditorState,
  template: Pick<TemplateItem, 'employerSignatureMode' | 'notReadyReasons'>,
  pdf: PdfFacts,
): EditorCheck {
  const errors = noErrors();
  const body = fieldsBody(state);
  const result = templateUpdateSchema.safeParse({ fields: body });
  if (!result.success) {
    for (const issue of result.error.issues) {
      const [, index, ...path] = issue.path;
      if (typeof index !== 'number') {
        errors.general ??= text.tooManyPositions(TEMPLATE_MAX_FIELDS);
        continue;
      }
      place(errors, state, index, path, (prop) => {
        if (isPositionNumber(prop)) {
          const typed = body[index]?.[prop];
          const shown =
            typeof typed === 'number' ? String(typed) : typeof typed === 'string' ? typed : '';
          return numberText(prop, shown, issue);
        }
        if (prop === 'showWhen') return text.conditionInvalid;
        return settingText(prop, issue);
      });
    }
  }

  const seenKeys = new Map<string, string>();
  for (const box of state.boxes) {
    const owner = seenKeys.get(box.key);
    if (owner !== undefined && owner !== box.uid) {
      (errors.boxes[box.uid] ??= {}).key ??= text.keyUsed;
    }
    seenKeys.set(box.key, box.uid);
    for (const prop of ['minDate', 'maxDate'] as const) {
      const limit = box[prop];
      if (limit.kind === 'fixed' && parseDay(limit.text) === null) {
        (errors.boxes[box.uid] ??= {})[prop] = text.dateFormat;
      }
    }
  }

  const footer = new Set<string>();
  const parsed = result.success ? (result.data.fields ?? []) : null;
  state.positions.forEach((position, index) => {
    const field = parsed?.[index];
    if (!field) return;
    if (inFooter(field.y)) footer.add(position.uid);
    const problem = pdf.pages ? pageProblem(field, pdf.pages) : null;
    if (problem) {
      const size = pdf.pages?.[field.page - 1];
      (errors.positions[position.uid] ??= {}).general ??=
        problem === 'page_not_found' || !size
          ? text.pageNotFound(pdf.pages?.length ?? 0)
          : text.outsidePage(Math.round(size.width), Math.round(size.height));
    }
  });

  const readiness = parsed
    ? templateReadiness({
        employerSignatureMode: template.employerSignatureMode,
        fields: parsed,
        // The stored reasons say whether the image is missing (the item has no flag of its own).
        employerSignatureImageUploaded: !template.notReadyReasons.some(
          ({ code }) => code === 'EMPLOYER_SIGNATURE_IMAGE_MISSING',
        ),
      })
    : null;
  return {
    fields: parsed && !hasErrors(errors) ? parsed : null,
    errors,
    inFooter: footer,
    readiness,
    parsed,
  };
}

const outsidePageSchema = z.array(
  z.object({
    index: z.number().int(),
    page: z.number().int(),
    reason: z.enum(['page_not_found', 'outside_page']),
  }),
);

/**
 * A refused save → the boxes and positions to mark, by the index of the list that was sent,
 * in our own Hebrew (never text from the answer). Null when the error belongs to no box.
 */
export function serverEditorErrors(error: unknown, state: EditorState): EditorErrors | null {
  if (!isApiRequestError(error) || error.code === null) return null;
  const errors = noErrors();
  if (error.code === 'TEMPLATE_FIELD_OUTSIDE_PAGE') {
    const parsed = outsidePageSchema.safeParse(error.details?.fields);
    if (!parsed.success) return null;
    for (const { index } of parsed.data) {
      const position = state.positions[index];
      if (position) {
        (errors.positions[position.uid] ??= {}).general ??= errorMessage(
          'TEMPLATE_FIELD_OUTSIDE_PAGE',
        );
      } else {
        errors.general ??= errorMessage('TEMPLATE_FIELD_OUTSIDE_PAGE');
      }
    }
    return hasErrors(errors) ? errors : null;
  }
  if (error.code !== 'VALIDATION_FAILED') return null;
  const parsed = z.array(fieldErrorSchema).safeParse(error.details?.fields);
  if (!parsed.success) return null;
  for (const item of parsed.data) {
    const [head, index, ...path] = item.field.split('.');
    const at = Number(index);
    if (head !== 'fields' || !Number.isInteger(at)) {
      errors.general ??= errorMessage(item.code);
      continue;
    }
    place(errors, state, at, path, () => errorMessage(item.code));
  }
  return hasErrors(errors) ? errors : null;
}
