import { describe, expect, it } from 'vitest';
import {
  candidateTemplate,
  DEPT_15,
  DEPT_19,
  DEPT_61,
  READY_FIELDS,
} from '../../../test/fixtures/rounds.js';
import { departmentReport, planByDepartment, planSingleTemplate } from './round-templates.js';

const departments = [DEPT_61, DEPT_15, DEPT_19];
const everyoneActive = new Map(departments.map(({ id }) => [id, 3]));

describe('planByDepartment', () => {
  it('uses the one ready template, warns about a department with none, asks for a choice', () => {
    const only = candidateTemplate({ id: 1, departments: [DEPT_15] });
    const first = candidateTemplate({ id: 2, departments: [DEPT_19] });
    const second = candidateTemplate({ id: 3, departments: [DEPT_19] });
    const plan = planByDepartment({
      departments,
      linked: [only, first, second],
      choices: new Map(),
      activeRecipients: everyoneActive,
    });
    expect(plan.departments.map(({ department, status }) => [department.code, status])).toEqual([
      [15, 'ready'],
      [19, 'choice_needed'],
      [61, 'no_template'],
    ]);
    expect(plan.departments[0]?.template).toBe(only);
    expect(plan.departments[1]?.options).toEqual([first, second]);
    expect(plan.blockers.map(({ code, departmentId }) => [code, departmentId])).toEqual([
      ['DEPARTMENT_TEMPLATE_CHOICE_NEEDED', DEPT_19.id],
    ]);
    expect(plan.warnings.map(({ code, departmentId }) => [code, departmentId])).toEqual([
      ['DEPARTMENT_HAS_NO_TEMPLATE', DEPT_61.id],
    ]);
  });

  it('uses the choice from the body, and keeps the other options visible', () => {
    const first = candidateTemplate({ id: 2, departments: [DEPT_19] });
    const second = candidateTemplate({ id: 3, departments: [DEPT_19] });
    const plan = planByDepartment({
      departments: [DEPT_19],
      linked: [first, second],
      choices: new Map([[DEPT_19.id, second.row.id]]),
      activeRecipients: everyoneActive,
    });
    expect(plan.departments[0]?.status).toBe('ready');
    expect(plan.departments[0]?.template).toBe(second);
    expect(plan.departments[0]?.options).toHaveLength(2);
    expect(plan.blockers).toEqual([]);
  });

  it('refuses a choice that is not one of the department ready templates', () => {
    const mine = candidateTemplate({ id: 2, departments: [DEPT_19] });
    const other = candidateTemplate({ id: 4, departments: [DEPT_15] });
    const plan = planByDepartment({
      departments: [DEPT_19],
      linked: [mine, other],
      choices: new Map([[DEPT_19.id, other.row.id]]),
      activeRecipients: everyoneActive,
    });
    expect(plan.departments[0]?.status).toBe('choice_needed');
    expect(plan.blockers.map(({ code, templateId }) => [code, templateId])).toEqual([
      ['DEPARTMENT_TEMPLATE_CHOICE_INVALID', other.row.id],
    ]);
  });

  it('does not offer a template that is not ready or waits for the employer signature image', () => {
    const notReady = candidateTemplate({
      id: 5,
      fields: READY_FIELDS.filter(({ fieldType }) => fieldType !== 'signature'),
    });
    const noImage = candidateTemplate({
      id: 6,
      employerSignatureMode: 'pre_signed',
      fields: [...READY_FIELDS, { fieldType: 'employer_signature' }],
      imageUploaded: false,
    });
    const plan = planByDepartment({
      departments: [DEPT_15],
      linked: [notReady, noImage],
      choices: new Map(),
      activeRecipients: everyoneActive,
    });
    const [entry] = plan.departments;
    expect(entry?.status).toBe('no_template');
    expect(entry?.options).toEqual([]);
    const report = entry && departmentReport(entry, 3);
    expect(report?.notOffered.map(({ reasons }) => reasons.map(({ code }) => code))).toEqual([
      ['NO_MAIN_SIGNATURE'],
      ['EMPLOYER_SIGNATURE_IMAGE_MISSING'],
    ]);
    expect(report?.label).toBe('15 - ממלאות מקום ירושלים');
  });

  it('gives no blocker or warning for a department without active recipients', () => {
    const plan = planByDepartment({
      departments: [DEPT_61, DEPT_19],
      linked: [
        candidateTemplate({ id: 2, departments: [DEPT_19] }),
        candidateTemplate({ id: 3, departments: [DEPT_19] }),
      ],
      choices: new Map(),
      activeRecipients: new Map(),
    });
    expect(plan.blockers).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });
});

describe('planSingleTemplate', () => {
  it('gives every department the template, sorted by code', () => {
    const template = candidateTemplate({ id: 1 });
    const plan = planSingleTemplate(template, departments);
    expect(plan.departments.map(({ department }) => department.code)).toEqual([15, 19, 61]);
    expect(plan.departments.every((entry) => entry.template === template)).toBe(true);
    expect(plan.blockers).toEqual([]);
  });

  it('blocks a template that is archived, old or not ready', () => {
    const archived = candidateTemplate({ id: 1, isArchived: true });
    expect(planSingleTemplate(archived, []).blockers.map(({ code }) => code)).toEqual([
      'TEMPLATE_NOT_ACTIVE',
    ]);
    const old = candidateTemplate({ id: 2, isLatest: false });
    expect(planSingleTemplate(old, []).blockers.map(({ code }) => code)).toEqual([
      'TEMPLATE_NOT_ACTIVE',
    ]);
    const noImage = candidateTemplate({
      id: 3,
      employerSignatureMode: 'after_employee',
      fields: [...READY_FIELDS, { fieldType: 'employer_signature' }],
      imageUploaded: false,
    });
    const [only] = planSingleTemplate(noImage, []).blockers;
    expect(only?.code).toBe('TEMPLATE_NOT_READY');
    expect(only?.reasons.map(({ code }) => code)).toEqual(['EMPLOYER_SIGNATURE_IMAGE_MISSING']);
  });
});
