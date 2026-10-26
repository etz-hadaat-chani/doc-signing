import { TEMPLATE_FIELD_TYPES } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { he } from '../../../i18n/he';
import { isolateLtr } from '../template-view';
import { ADD_GROUPS, cardControls, conditionTargets } from './editor-rules';
import { addBox, type EditorState, stateFromFields, updateBox } from './editor-state';

const text = he.templates.editor;

describe('what a card shows per type (FR-TPL-10)', () => {
  it('the six box types: own key, label required, approval, no fill-mode choice', () => {
    for (const fieldType of [
      'text',
      'long_text',
      'select',
      'checkbox',
      'date_input',
      'drawing',
    ] as const) {
      const controls = cardControls({ fieldType, fillMode: 'employee' });
      expect(controls).toMatchObject({
        fillModes: [],
        keyEditable: true,
        label: true,
        labelRequired: true,
        approval: true,
        conditionPerPosition: false,
      });
    }
    expect(cardControls({ fieldType: 'text', fillMode: 'employee' }).maxLength).toBe(500);
    expect(cardControls({ fieldType: 'long_text', fillMode: 'employee' }).maxLength).toBe(2000);
    expect(cardControls({ fieldType: 'select', fillMode: 'employee' }).choices).toBe(true);
    expect(cardControls({ fieldType: 'date_input', fillMode: 'employee' }).dates).toBe(true);
  });

  it('a system value with three fill modes: limits and approval only when the employee may fill it', () => {
    const system = cardControls({ fieldType: 'address', fillMode: 'system' });
    expect(system.fillModes).toEqual(['system', 'employee', 'system_then_employee']);
    expect(system).toMatchObject({
      keyEditable: false,
      approval: false,
      maxLength: null,
      labelRequired: false,
    });
    const filled = cardControls({ fieldType: 'address', fillMode: 'system_then_employee' });
    expect(filled).toMatchObject({ approval: true, maxLength: 500, labelRequired: true });
  });

  it('fixed system values, the email pair and signatures', () => {
    expect(cardControls({ fieldType: 'full_name', fillMode: 'system' })).toMatchObject({
      fillModes: [],
      required: true,
      approval: false,
    });
    expect(cardControls({ fieldType: 'email_input', fillMode: 'employee' })).toMatchObject({
      label: false,
      required: false,
    });
    expect(cardControls({ fieldType: 'signature', fillMode: null })).toMatchObject({
      fillModes: [],
      label: false,
      required: false,
      approval: false,
      conditionPerPosition: true,
    });
    expect(cardControls({ fieldType: 'pension_no_fund', fillMode: 'system' }).pension).toBe(true);
  });

  it('the add menu offers every type once', () => {
    const offered = ADD_GROUPS.flatMap(({ types }) => types);
    expect([...offered].sort()).toEqual([...TEMPLATE_FIELD_TYPES].sort());
  });
});

describe('condition targets', () => {
  function build(): EditorState {
    let state = stateFromFields([]);
    for (const type of ['checkbox', 'select', 'text', 'email_input'] as const) {
      state = addBox(state, type).state;
    }
    const select = state.boxes[1]?.uid ?? '';
    return updateBox(state, select, { choices: ['בוקר', ' ערב ', '', 'בוקר'] });
  }

  it('checkboxes and lists with their values; not the box itself, not a text box', () => {
    const state = build();
    const [checkbox] = state.boxes;
    const targets = conditionTargets(state, state.boxes[2]?.uid ?? '');
    expect(targets).toEqual([
      {
        key: 'box_1',
        name: he.templates.boxName(he.templates.fieldTypes.checkbox, isolateLtr('box_1')),
        values: [
          { value: 'true', label: text.checked },
          { value: 'false', label: text.unchecked },
        ],
      },
      {
        key: 'box_2',
        name: he.templates.boxName(he.templates.fieldTypes.select, isolateLtr('box_2')),
        values: [
          { value: 'בוקר', label: 'בוקר' },
          { value: 'ערב', label: 'ערב' },
        ],
      },
    ]);
    expect(conditionTargets(state, checkbox?.uid ?? '').map(({ key }) => key)).toEqual(['box_2']);
  });

  it('a box with its own condition is no target; the email choice needs both email boxes', () => {
    let state = build();
    state = updateBox(state, state.boxes[0]?.uid ?? '', {
      showWhen: { key: 'box_2', equals: 'ערב' },
    });
    expect(conditionTargets(state, 'none').map(({ key }) => key)).toEqual(['box_2']);
    state = addBox(state, 'no_email_checkbox').state;
    const email = conditionTargets(state, 'none').at(-1);
    expect(email).toEqual({
      key: 'email_choice',
      name: text.emailChoice,
      values: [
        { value: 'email', label: text.emailChoices.email },
        { value: 'office', label: text.emailChoices.office },
      ],
    });
  });
});
