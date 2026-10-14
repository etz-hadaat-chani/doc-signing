import { describe, expect, it } from 'vitest';
import {
  missingFieldTypes,
  templateCreateSchema,
  templateFieldInputSchema,
  templateListQuerySchema,
  templateUpdateSchema,
} from './templates.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const field = { fieldType: 'full_name', page: 1, x: 10, y: 20, width: 100, height: 15 };

const messagesOf = (result: { error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map(({ message }) => message) ?? [];

describe('templateFieldInputSchema', () => {
  it.each(['full_name', 'id_number', 'date', 'signature'])('accepts %s', (fieldType) => {
    expect(templateFieldInputSchema.parse({ ...field, fieldType }).fieldType).toBe(fieldType);
  });

  it.each(['checkbox', 'text'])('refuses %s for now, with its own code', (fieldType) => {
    const result = templateFieldInputSchema.safeParse({ ...field, fieldType });
    expect(messagesOf(result)).toEqual(['TEMPLATE_FIELD_TYPE_NOT_SUPPORTED']);
  });

  it('refuses an unknown type', () => {
    expect(templateFieldInputSchema.safeParse({ ...field, fieldType: 'photo' }).success).toBe(
      false,
    );
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
    ['an unknown key', { fontSize: 12 }],
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

describe('missingFieldTypes', () => {
  it('lists the MVP types with no position, in a fixed order', () => {
    expect(missingFieldTypes([])).toEqual(['full_name', 'id_number', 'date', 'signature']);
    expect(
      missingFieldTypes([{ fieldType: 'date' }, { fieldType: 'date' }, { fieldType: 'full_name' }]),
    ).toEqual(['id_number', 'signature']);
  });
});
