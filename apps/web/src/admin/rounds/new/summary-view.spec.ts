import {
  ROUND_PREVIEW_BLOCKERS,
  ROUND_PREVIEW_WARNINGS,
  TEMPLATE_NOT_READY_MESSAGES,
} from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { readyTemplate } from '../../templates/templates.fixtures';
import { byDepartmentReport, DEPT_19, report, TEMPLATE_B_ID } from './rounds.fixtures';
import {
  blockerLines,
  choiceValue,
  hiddenRows,
  listKinds,
  summaryTiles,
  warningLines,
} from './summary-view';

describe('summaryTiles', () => {
  it('single_template: the main counts; no department counts while they are 0', () => {
    expect(summaryTiles(report()).map(({ key }) => key)).toEqual([
      'willSendEmail',
      'noEmail',
      'missingData',
      'inRound',
      'alreadySigned',
      'alreadyOpen',
      'inactive',
    ]);
  });

  it('by_department: also "no template" and "waiting for a choice"', () => {
    const tiles = summaryTiles(byDepartmentReport());
    expect(tiles.slice(-2)).toEqual([
      { key: 'noTemplate', label: 'במחלקה בלי תבנית', value: 4 },
      { key: 'waitingForChoice', label: 'ממתינים לבחירת תבנית', value: 2 },
    ]);
  });
});

describe('blockers and warnings', () => {
  it('our Hebrew by code with the department, never the server text', () => {
    const data = byDepartmentReport();
    expect(blockerLines(data)).toEqual([
      {
        key: 'DEPARTMENT_TEMPLATE_CHOICE_NEEDED-0',
        text: `19 - מחלקה לדוגמה ב: ${ROUND_PREVIEW_BLOCKERS.DEPARTMENT_TEMPLATE_CHOICE_NEEDED}`,
        reasons: [],
      },
    ]);
    expect(warningLines(data)[0]?.text).toBe(
      `15 - מחלקה לדוגמה א: ${ROUND_PREVIEW_WARNINGS.DEPARTMENT_HAS_NO_TEMPLATE}`,
    );
    expect(JSON.stringify([blockerLines(data), warningLines(data)])).not.toContain('server');
  });

  it('a template that is not ready lists its reasons', () => {
    const data = report({
      canCreate: false,
      blockers: [
        {
          code: 'TEMPLATE_NOT_READY',
          message: 'x',
          departmentId: null,
          templateId: readyTemplate.id,
          reasons: [{ code: 'NO_MAIN_SIGNATURE', message: 'x', keys: [] }],
        },
      ],
    });
    expect(blockerLines(data)).toEqual([
      {
        key: 'TEMPLATE_NOT_READY-0',
        text: ROUND_PREVIEW_BLOCKERS.TEMPLATE_NOT_READY,
        reasons: [TEMPLATE_NOT_READY_MESSAGES.NO_MAIN_SIGNATURE],
      },
    ]);
  });
});

describe('lists', () => {
  it('only the lists with anyone, in tab order', () => {
    expect(listKinds(report())).toEqual([
      'missingData',
      'noEmail',
      'alreadySigned',
      'inactivePicked',
    ]);
  });

  it('"and N more" counts the rows the answer cut', () => {
    expect(hiddenRows({ total: 620, items: new Array(500) })).toBe(120);
    expect(hiddenRows({ total: 3, items: new Array(3) })).toBe(0);
  });
});

describe('choiceValue', () => {
  const department = byDepartmentReport().departments.find(({ id }) => id === DEPT_19.id);
  if (!department) throw new Error('fixture');

  it("the manager's choice, else the template the preview settled on, else none", () => {
    expect(choiceValue(department, {})).toBe('');
    expect(choiceValue(department, { [DEPT_19.id]: TEMPLATE_B_ID })).toBe(TEMPLATE_B_ID);
    expect(choiceValue(department, { [DEPT_19.id]: 'not-an-option' })).toBe('');
    const settled = {
      ...department,
      status: 'ready' as const,
      template: department.options[0] ?? null,
    };
    expect(choiceValue(settled, {})).toBe(readyTemplate.id);
  });
});
