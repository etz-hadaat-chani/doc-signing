import { describe, expect, it } from 'vitest';
import { TEMPLATE_FIELD_TYPES } from './enums.js';
import {
  templateCreateSchema,
  templateFieldInputSchema,
  templateListQuerySchema,
  templateUpdateSchema,
} from './templates.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const field = { fieldType: 'full_name', page: 1, x: 10, y: 20, width: 100, height: 15 };

describe('templateFieldInputSchema', () => {
  it.each(TEMPLATE_FIELD_TYPES)('accepts %s', (fieldType) => {
    expect(templateFieldInputSchema.parse({ ...field, fieldType }).fieldType).toBe(fieldType);
  });

  it.each(['photo', 'work_hours'])('refuses the unknown type %s', (fieldType) => {
    const result = templateFieldInputSchema.safeParse({ ...field, fieldType });
    expect(result.success).toBe(false);
  });

  it('an old-style position (no settings) gets the defaults of its type', () => {
    expect(templateFieldInputSchema.parse(field)).toEqual({
      ...field,
      key: 'full_name',
      fillMode: 'system',
      showWhen: null,
      options: null,
      isRequired: true,
      label: null,
      needsApproval: false,
    });
  });

  it('rounds to 2 decimals, as the database stores it', () => {
    const parsed = templateFieldInputSchema.parse({ ...field, x: 10.005, width: 99.999 });
    expect(parsed.x).toBe(10.01);
    expect(parsed.width).toBe(100);
  });

  it.each([
    ['page 0', { page: 0 }],
    ['a page that is not whole', { page: 1.5 }],
    ['a negative x', { x: -1 }],
    ['a negative y', { y: -0.5 }],
    ['width 0', { width: 0 }],
    ['a height that rounds to 0', { height: 0.004 }],
    ['an unknown property', { fontSize: 12 }],
  ])('refuses %s', (_name, change) => {
    expect(templateFieldInputSchema.safeParse({ ...field, ...change }).success).toBe(false);
  });
});

describe('templateCreateSchema (multipart text fields)', () => {
  it('reads departmentIds comma-separated, repeated or both, once each', () => {
    expect(templateCreateSchema.parse({ name: ' Form ', departmentIds: `${A}, ${B}` })).toEqual({
      name: 'Form',
      departmentIds: [A, B],
    });
    expect(templateCreateSchema.parse({ name: 'Form', departmentIds: [A, `${B},${A}`] })).toEqual({
      name: 'Form',
      departmentIds: [A, B],
    });
  });

  it.each([
    ['no departments', { name: 'Form', departmentIds: '' }],
    ['a department that is not a uuid', { name: 'Form', departmentIds: 'abc' }],
    ['an empty name', { name: '   ', departmentIds: A }],
    ['a name over 150 characters', { name: 'a'.repeat(151), departmentIds: A }],
    ['an unknown field', { name: 'Form', departmentIds: A, kind: 'signature' }],
  ])('refuses %s', (_name, body) => {
    expect(templateCreateSchema.safeParse(body).success).toBe(false);
  });
});

describe('templateUpdateSchema', () => {
  it('needs at least one key', () => {
    expect(templateUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('accepts an empty list of positions (all removed)', () => {
    expect(templateUpdateSchema.parse({ fields: [] })).toEqual({ fields: [] });
  });

  it('gives boxes without a key the next box_<n>, keeping the keys sent', () => {
    const box = { ...field, fieldType: 'text' };
    const parsed = templateUpdateSchema.parse({
      fields: [box, { ...box, key: 'box_4' }, box, { ...box, key: 'notes' }],
    });
    expect(parsed.fields?.map(({ key }) => key)).toEqual(['box_5', 'box_4', 'box_6', 'notes']);
  });

  it('accepts employerSignatureMode alone, and refuses an unknown one', () => {
    expect(templateUpdateSchema.parse({ employerSignatureMode: 'pre_signed' })).toEqual({
      employerSignatureMode: 'pre_signed',
    });
    expect(templateUpdateSchema.safeParse({ employerSignatureMode: 'later' }).success).toBe(false);
  });

  it('refuses more than 40 positions', () => {
    const fields = Array.from({ length: 41 }, () => field);
    expect(templateUpdateSchema.safeParse({ fields }).success).toBe(false);
  });
});

describe('templateListQuerySchema', () => {
  it('shows only active templates by default', () => {
    expect(templateListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
      includeArchived: false,
    });
  });

  it('reads includeArchived and dept', () => {
    expect(templateListQuerySchema.parse({ includeArchived: 'true', dept: A })).toMatchObject({
      includeArchived: true,
      dept: A,
    });
    expect(templateListQuerySchema.safeParse({ includeArchived: 'yes' }).success).toBe(false);
  });
});
