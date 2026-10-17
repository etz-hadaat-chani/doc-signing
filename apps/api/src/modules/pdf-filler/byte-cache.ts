/**
 * Files by storage key, in memory, up to `maxBytes` in all; the least recently used go first.
 * Only for keys that never change (templates, signature images: uploads never overwrite, 2.5), so
 * a cached file is never stale. A file larger than the whole limit is not kept.
 */
export class ByteCache<T extends { byteLength: number }> {
  private readonly entries = new Map<string, T>();
  private bytes = 0;

  constructor(readonly maxBytes: number) {}

  get size(): number {
    return this.bytes;
  }

  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      // Most recently used goes to the end.
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: T): void {
    const old = this.entries.get(key);
    if (old !== undefined) {
      this.entries.delete(key);
      this.bytes -= old.byteLength;
    }
    if (value.byteLength > this.maxBytes) return;
    this.entries.set(key, value);
    this.bytes += value.byteLength;
    for (const [oldest, item] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      this.entries.delete(oldest);
      this.bytes -= item.byteLength;
    }
  }

  /** The cached value, or `load()` once and keep it. */
  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await load();
    this.set(key, value);
    return value;
  }
}
