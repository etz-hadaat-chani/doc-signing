import { describe, expect, it } from 'vitest';

describe('@doc-signing/shared entry point', () => {
  it('loads as an ES module', async () => {
    const mod = await import('./index.js');
    expect(typeof mod).toBe('object');
  });
});
