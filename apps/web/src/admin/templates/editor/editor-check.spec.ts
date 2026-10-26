import { errorMessage, type TemplateItem } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../api/api-error';
import { he } from '../../../i18n/he';
import { checkEditor, serverEditorErrors } from './editor-check';
import {
  addBox,
  type EditorState,
  renameKey,
  stateFromFields,
  updateBox,
  updatePosition,
} from './editor-state';

const text = he.templates.editor;
const a4 = { width: 595.28, height: 841.89 };
const template: Pick<TemplateItem, 'employerSignatureMode' | 'notReadyReasons'> = {
  employerSignatureMode: 'none',
  notReadyReasons: [],
};

function withBoxes(...types: Parameters<typeof addBox>[1][]): EditorState {
  let state = stateFromFields([]);
  for (const type of types) state = addBox(state, type).state;
  return state;
}

const codes = (state: EditorState) =>
  checkEditor(state, template, { pages: [a4] }).readiness?.map(({ code }) => code);

describe('the whole list through the shared schema', () => {
  it('a number that can’t be read, a zero width and a page below 1 go to their position', () => {
    let state = withBoxes('signature');
    const uid = state.positions[0]?.uid ?? '';
    state = updatePosition(state, uid, { x: 'abc', width: '0', page: '0' });
    const check = checkEditor(state, template, { pages: [a4] });
    expect(check.fields).toBeNull();
    expect(check.errors.positions[uid]).toEqual({
      x: text.notNumber,
      width: text.sizePositive,
      page: text.pageNumber,
    });
    expect(check.readiness).toBeNull();
  });

  it('a reserved key, a too long limit and a bad list option go to their box', () => {
    let state = withBoxes('signature', 'text', 'select');
    const [, textBox, selectBox] = state.boxes;
    state = renameKey(state, textBox?.uid ?? '', 'full_name');
    state = updateBox(state, textBox?.uid ?? '', { maxLength: '600' });
    state = updateBox(state, selectBox?.uid ?? '', { choices: ['א', 'א'] });
    const { errors } = checkEditor(state, template, { pages: [a4] });
    expect(errors.boxes[textBox?.uid ?? '']).toEqual({
      key: errorMessage('TEMPLATE_FIELD_KEY_NOT_ALLOWED'),
      maxLength: errorMessage('TEMPLATE_FIELD_LIMIT_INVALID'),
    });
    expect(errors.boxes[selectBox?.uid ?? '']).toEqual({
      choices: errorMessage('TEMPLATE_FIELD_LIMIT_INVALID'),
    });
  });

  it('a key used by two boxes and a date that can’t be read', () => {
    let state = withBoxes('signature', 'checkbox', 'date_input');
    const [, checkbox, date] = state.boxes;
    state = renameKey(state, date?.uid ?? '', checkbox?.key ?? '');
    state = updateBox(state, date?.uid ?? '', { minDate: { kind: 'fixed', text: '31/31/2026' } });
    const { errors } = checkEditor(state, template, { pages: [a4] });
    expect(errors.boxes[date?.uid ?? '']).toMatchObject({ key: text.keyUsed });
    // 31/31 reads as a shape but isn't a real day: the shared schema refuses it.
    expect(errors.boxes[date?.uid ?? '']?.minDate).toBe(
      errorMessage('TEMPLATE_FIELD_LIMIT_INVALID'),
    );
  });

  it('checks the page sizes pdf.js read', () => {
    let state = withBoxes('signature', 'full_name');
    const [first, second] = state.positions;
    state = updatePosition(state, first?.uid ?? '', { page: '3' });
    state = updatePosition(state, second?.uid ?? '', { x: '500', width: '100' });
    const check = checkEditor(state, template, { pages: [a4, a4] });
    expect(check.errors.positions[first?.uid ?? '']?.general).toBe(text.pageNotFound(2));
    expect(check.errors.positions[second?.uid ?? '']?.general).toBe(text.outsidePage(595, 842));
    // Before the PDF is read, only the server can tell.
    expect(checkEditor(state, template, { pages: null }).fields).not.toBeNull();
  });
});

describe('live readiness (FR-TPL-8)', () => {
  it('an empty list has no main signature; one always-shown signature is ready', () => {
    expect(codes(stateFromFields([]))).toEqual(['NO_MAIN_SIGNATURE']);
    expect(codes(withBoxes('signature'))).toEqual([]);
  });

  it('a box without a label, a list with too few options, half an email section', () => {
    expect(codes(withBoxes('signature', 'select', 'email_input'))).toEqual([
      'EMAIL_SECTION_INCOMPLETE',
      'LABEL_MISSING',
      'TOO_FEW_CHOICES',
    ]);
  });

  it('the 16 pt rule: a warning on the position, a reason on the template, not a blocker', () => {
    let state = withBoxes('signature');
    const uid = state.positions[0]?.uid ?? '';
    state = updatePosition(state, uid, { y: '10' });
    const check = checkEditor(state, template, { pages: [a4] });
    expect(check.inFooter.has(uid)).toBe(true);
    expect(check.readiness?.map(({ code }) => code)).toEqual(['POSITION_IN_FOOTER']);
    expect(check.fields).not.toBeNull();
    state = updatePosition(state, uid, { y: '16' });
    expect(checkEditor(state, template, { pages: [a4] }).inFooter.size).toBe(0);
  });

  it('the image flag comes from the stored reasons', () => {
    const state = withBoxes('signature', 'employer_signature');
    const missing = checkEditor(
      state,
      {
        employerSignatureMode: 'pre_signed',
        notReadyReasons: [{ code: 'EMPLOYER_SIGNATURE_IMAGE_MISSING', message: 'x', keys: [] }],
      },
      { pages: [a4] },
    );
    expect(missing.readiness?.map(({ code }) => code)).toEqual([
      'EMPLOYER_SIGNATURE_IMAGE_MISSING',
    ]);
  });
});

describe('server errors → boxes', () => {
  const state = withBoxes('signature', 'text');
  const [signature, note] = state.positions;
  const textBox = state.boxes[1];

  it('TEMPLATE_FIELD_OUTSIDE_PAGE marks the position by index', () => {
    const error = new ApiRequestError({
      kind: 'api',
      status: 400,
      code: 'TEMPLATE_FIELD_OUTSIDE_PAGE',
      details: { fields: [{ index: 1, page: 1, reason: 'outside_page' }] },
    });
    expect(serverEditorErrors(error, state)?.positions).toEqual({
      [note?.uid ?? '']: { general: errorMessage('TEMPLATE_FIELD_OUTSIDE_PAGE') },
    });
  });

  it('VALIDATION_FAILED fields.<i>.<prop> marks the box or the position', () => {
    const error = new ApiRequestError({
      kind: 'api',
      status: 400,
      code: 'VALIDATION_FAILED',
      details: {
        fields: [
          { field: 'fields.1.label', code: 'VALIDATION_FAILED', message: 'x' },
          { field: 'fields.0.y', code: 'VALIDATION_FAILED', message: 'x' },
        ],
      },
    });
    const errors = serverEditorErrors(error, state);
    expect(errors?.boxes[textBox?.uid ?? '']).toEqual({ label: errorMessage('VALIDATION_FAILED') });
    expect(errors?.positions[signature?.uid ?? '']).toEqual({
      y: errorMessage('VALIDATION_FAILED'),
    });
  });

  it('other errors belong to no box', () => {
    const error = new ApiRequestError({ kind: 'api', status: 409, code: 'TEMPLATE_ARCHIVED' });
    expect(serverEditorErrors(error, state)).toBeNull();
    expect(serverEditorErrors(new Error('x'), state)).toBeNull();
  });
});
