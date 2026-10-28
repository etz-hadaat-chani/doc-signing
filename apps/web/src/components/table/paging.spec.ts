import { describe, expect, it } from 'vitest';
import { pageOf } from './paging';

describe('pageOf', () => {
  it('slices a list into the API list shape', () => {
    const items = Array.from({ length: 30 }, (_, index) => index);
    expect(pageOf(items, 2, 25)).toEqual({
      items: [25, 26, 27, 28, 29],
      total: 30,
      page: 2,
      pageSize: 25,
    });
  });
});
