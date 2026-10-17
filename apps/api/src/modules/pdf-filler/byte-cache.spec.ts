import { describe, expect, it, vi } from 'vitest';
import { ByteCache } from './byte-cache.js';

const bytes = (size: number) => new Uint8Array(size);

describe('ByteCache', () => {
  it('drops the least recently used files once over the limit', () => {
    const cache = new ByteCache<Uint8Array>(10);
    cache.set('a', bytes(4));
    cache.set('b', bytes(4));
    cache.get('a'); // a is now the most recently used
    cache.set('c', bytes(4));
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
    expect(cache.size).toBe(8);
  });

  it('never keeps a file larger than the whole limit', () => {
    const cache = new ByteCache<Uint8Array>(10);
    cache.set('a', bytes(4));
    cache.set('big', bytes(11));
    expect(cache.get('big')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.size).toBe(4);
  });

  it('loads a key once, then serves it from memory', async () => {
    const cache = new ByteCache<Uint8Array>(100);
    const load = vi.fn(async () => Promise.resolve(bytes(5)));
    const first = await cache.getOrLoad('templates/a.pdf', load);
    const second = await cache.getOrLoad('templates/a.pdf', load);
    expect(second).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('setting a key again replaces it and counts its size once', () => {
    const cache = new ByteCache<Uint8Array>(100);
    cache.set('a', bytes(4));
    cache.set('a', bytes(6));
    expect(cache.size).toBe(6);
  });
});
