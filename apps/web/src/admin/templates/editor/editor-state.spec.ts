import { type TemplateField, templateFieldListSchema } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import {
  addBox,
  addPosition,
  fieldsBody,
  removeBox,
  removePosition,
  renameKey,
  sameAsStored,
  stateFromFields,
  updateBox,
  updatePosition,
} from './editor-state';

let id = 0;
/** A stored position with every default filled in, as the API returns it. */
function stored(spec: Record<string, unknown>): TemplateField {
  id += 1;
  const [field] = templateFieldListSchema.parse([
    { page: 1, x: 50, y: 700 - id * 30, width: 150, height: 20, ...spec },
  ]);
  if (!field) throw new Error('no field');
  return { id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, ...field };
}

const signature = stored({ fieldType: 'signature' });
const officeLine = stored({
  fieldType: 'signature',
  showWhen: { key: 'email_choice', equals: 'office' },
});
const select = stored({
  fieldType: 'select',
  key: 'shift',
  label: 'משמרת',
  options: { choices: ['בוקר', 'ערב'] },
});
const name = stored({ fieldType: 'full_name' });
const selectAgain = { ...select, id: '00000000-0000-4000-8000-000000000999', page: 2 };
const STORED = [signature, select, name, officeLine, selectAgain];

describe('stored positions → boxes', () => {
  it('groups by key in first-appearance order; signatures keep their condition per position', () => {
    const state = stateFromFields(STORED);
    expect(state.boxes.map(({ key }) => key)).toEqual(['signature', 'shift', 'full_name']);
    expect(state.positions.map(({ boxUid }) => boxUid)).toEqual([
      'box-signature',
      'box-shift',
      'box-full_name',
      'box-signature',
      'box-shift',
    ]);
    expect(state.positions[3]?.showWhen).toEqual({ key: 'email_choice', equals: 'office' });
    expect(state.boxes[1]?.choices).toEqual(['בוקר', 'ערב']);
    expect(state.mixedKeys).toEqual([]);
  });

  it('notes a key whose stored positions had different settings', () => {
    const other = { ...select, id: '00000000-0000-4000-8000-000000000998', label: 'אחר' };
    expect(stateFromFields([select, other]).mixedKeys).toEqual(['shift']);
  });

  it('an untouched editor sends the stored list back, in the stored order', () => {
    const body = templateFieldListSchema.parse(fieldsBody(stateFromFields(STORED)));
    expect(sameAsStored(body, STORED)).toBe(true);
  });

  it('a moved position is a change', () => {
    const state = stateFromFields(STORED);
    const moved = updatePosition(state, name.id, { y: '123.5' });
    const body = templateFieldListSchema.parse(fieldsBody(moved));
    expect(body[2]?.y).toBe(123.5);
    expect(sameAsStored(body, STORED)).toBe(false);
  });
});

describe('editing', () => {
  it('a new box gets the next free box key and the defaults of its type', () => {
    const { state, boxUid } = addBox(stateFromFields(STORED), 'text');
    const box = state.boxes.find(({ uid }) => uid === boxUid);
    expect(box).toMatchObject({ key: 'box_1', fillMode: 'employee', maxLength: '100' });
    expect(state.positions.at(-1)?.boxUid).toBe(boxUid);
    const second = addBox(state, 'long_text');
    expect(second.state.boxes.at(-1)).toMatchObject({ key: 'box_2', maxLength: '1000' });
  });

  it('a type with its own key that is already there gets one more position', () => {
    const start = stateFromFields(STORED);
    const { state, boxUid } = addBox(start, 'full_name');
    expect(boxUid).toBe('box-full_name');
    expect(state.boxes).toHaveLength(start.boxes.length);
    expect(state.positions).toHaveLength(start.positions.length + 1);
  });

  it('new positions start above the footer line', () => {
    const { state } = addBox(stateFromFields([]), 'signature');
    let next = state;
    for (let i = 0; i < 40; i += 1) next = addPosition(next, state.boxes[0]?.uid ?? '');
    expect(next.positions.every(({ y }) => Number(y) >= 16)).toBe(true);
  });

  it('renaming a key moves the conditions that pointed to it', () => {
    let state = stateFromFields(STORED);
    state = addBox(state, 'text').state;
    const text = state.boxes.at(-1);
    state = updateBox(state, text?.uid ?? '', { showWhen: { key: 'shift', equals: 'ערב' } });
    state = renameKey(state, 'box-shift', 'shift_time');
    expect(state.boxes.find(({ uid }) => uid === 'box-shift')?.key).toBe('shift_time');
    expect(state.boxes.at(-1)?.showWhen).toEqual({ key: 'shift_time', equals: 'ערב' });
    // A type with its own key can't be renamed.
    expect(renameKey(state, 'box-full_name', 'name')).toBe(state);
  });

  it('removing the last position removes the box; removing a box removes its positions', () => {
    const state = stateFromFields(STORED);
    const once = removePosition(state, selectAgain.id);
    expect(once.boxes).toHaveLength(3);
    expect(removePosition(once, select.id).boxes.map(({ key }) => key)).toEqual([
      'signature',
      'full_name',
    ]);
    expect(removeBox(state, 'box-signature').positions).toHaveLength(3);
  });

  it('sends only the limits the type and fill mode take', () => {
    let state = stateFromFields([]);
    state = addBox(state, 'address').state;
    const uid = state.boxes[0]?.uid ?? '';
    expect(fieldsBody(state)[0]?.options).toBeNull();
    state = updateBox(state, uid, { fillMode: 'system_then_employee', needsApproval: true });
    expect(fieldsBody(state)[0]).toMatchObject({
      options: { maxLength: 100 },
      needsApproval: true,
    });
    state = updateBox(state, uid, { fillMode: 'system' });
    // Approval is only for a box the employee may fill in.
    expect(fieldsBody(state)[0]).toMatchObject({ options: null, needsApproval: false });
  });

  it('dates: the signing day, a typed day as YYYY-MM-DD, or none', () => {
    let state = addBox(stateFromFields([]), 'date_input').state;
    const uid = state.boxes[0]?.uid ?? '';
    state = updateBox(state, uid, {
      minDate: { kind: 'fixed', text: '1/2/2026' },
      maxDate: { kind: 'signing_day', text: '' },
    });
    expect(fieldsBody(state)[0]?.options).toEqual({
      minDate: '2026-02-01',
      maxDate: 'signing_day',
    });
  });

  it('one pension source for all three pension types', () => {
    let state = stateFromFields([]);
    for (const type of ['pension_has_fund', 'pension_no_fund', 'pension_fund_name'] as const) {
      state = addBox(state, type).state;
    }
    state = { ...state, pensionSource: 'b_only' };
    expect(fieldsBody(state).map(({ options }) => options)).toEqual([
      { pensionSource: 'b_only' },
      { pensionSource: 'b_only' },
      { pensionSource: 'b_only' },
    ]);
  });
});
