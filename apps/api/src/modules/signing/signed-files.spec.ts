import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { StorageAdapter, type UploadResult } from '../../common/storage/storage.adapter.js';
import { StorageAlreadyExistsError } from '../../common/storage/storage.errors.js';
import { SignedFilesService, versionKey } from './signed-files.service.js';

describe('versionKey', () => {
  it('keeps the first key and numbers the next ones before the extension', () => {
    expect(versionKey('rounds/r/15/1001.pdf', 1)).toBe('rounds/r/15/1001.pdf');
    expect(versionKey('rounds/r/15/1001.pdf', 2)).toBe('rounds/r/15/1001-2.pdf');
    expect(versionKey('responses/a/initials.png', 3)).toBe('responses/a/initials-3.png');
  });
});

/** Storage in memory that never overwrites, like the real adapter. */
class MemoryStorage extends StorageAdapter {
  readonly files = new Map<string, Buffer>();

  upload(key: string, body: Buffer): Promise<UploadResult> {
    if (this.files.has(key)) return Promise.reject(new StorageAlreadyExistsError(key));
    this.files.set(key, Buffer.from(body));
    const sha256 = createHash('sha256').update(body).digest('hex');
    return Promise.resolve({ key, size: body.length, sha256 });
  }
  download(key: string): Promise<Buffer> {
    const file = this.files.get(key);
    return file ? Promise.resolve(file) : Promise.reject(new Error('missing'));
  }
  downloadStream(): never {
    throw new Error('not used');
  }
  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.files.has(key));
  }
  createDownloadLink(): never {
    throw new Error('not used');
  }
}

describe('SignedFilesService.storeFile', () => {
  const key = 'rounds/r/15/1001.pdf';
  const scan = Buffer.from('%PDF-1.7 scan');

  it('stores at the key when it is free', async () => {
    const storage = new MemoryStorage();
    const stored = await new SignedFilesService(storage).storeFile(key, scan, 'application/pdf');
    expect(stored).toMatchObject({ key, reused: false, strayKeys: [], size: scan.length });
    expect(stored.sha256).toBe(createHash('sha256').update(scan).digest('hex'));
  });

  it('keeps the same bytes already there (a retry)', async () => {
    const storage = new MemoryStorage();
    storage.files.set(key, Buffer.from(scan));
    const stored = await new SignedFilesService(storage).storeFile(key, scan, 'application/pdf');
    expect(stored).toMatchObject({ key, reused: true, strayKeys: [] });
  });

  it('never overwrites another file: next free key, the old one left as it was', async () => {
    const storage = new MemoryStorage();
    const other = Buffer.from('%PDF-1.7 a digital file');
    storage.files.set(key, other);
    const stored = await new SignedFilesService(storage).storeFile(key, scan, 'application/pdf');
    expect(stored).toMatchObject({
      key: 'rounds/r/15/1001-2.pdf',
      reused: false,
      strayKeys: [key],
    });
    expect(storage.files.get(key)).toEqual(other);
  });
});
