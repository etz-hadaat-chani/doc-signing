import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { pagedSchema, pageQuerySchema } from './pagination.js';

describe('pageQuerySchema', () => {
  it('uses defaults when missing', () => {
    expect(pageQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
  });

  it('reads query-string numbers', () => {
    expect(pageQuerySchema.parse({ page: '3', pageSize: '10' })).toEqual({ page: 3, pageSize: 10 });
  });

  it.each([
    ['page 0', { page: '0' }],
    ['a fraction', { page: '1.5' }],
    ['text', { page: 'abc' }],
    ['an empty value', { page: '' }],
    ['a repeated value', { page: ['1', '2'] }],
    ['pageSize over 100', { pageSize: '101' }],
    ['pageSize 0', { pageSize: '0' }],
  ])('rejects %s', (_name, query) => {
    expect(pageQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('pagedSchema', () => {
  it('checks a list response', () => {
    const schema = pagedSchema(z.string());
    expect(schema.safeParse({ items: ['a'], total: 1, page: 1, pageSize: 25 }).success).toBe(true);
    expect(schema.safeParse({ items: [1], total: 1, page: 1, pageSize: 25 }).success).toBe(false);
  });
});
