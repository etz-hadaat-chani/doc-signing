import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/common/config/config.schema.js';
import { S3StorageAdapter } from '../../src/common/storage/s3-storage.adapter.js';
import {
  StorageAlreadyExistsError,
  StorageNotFoundError,
} from '../../src/common/storage/storage.errors.js';

/** A small valid one-page PDF; the bytes are what matters here. */
const pdf = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
    '',
  ].join('\n'),
);
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// Runs against MinIO in the test bucket (db-setup.ts sets S3_BUCKET). Every test uses its own
// key prefix, so nothing has to be deleted between runs.
describe('S3StorageAdapter (MinIO)', () => {
  const storage = new S3StorageAdapter(loadConfig(process.env));
  let prefix: string;

  beforeAll(async () => {
    expect(process.env.S3_BUCKET).toMatch(/-test$/);
    await storage.onModuleInit();
    prefix = `tests/${randomUUID()}`;
  });

  afterAll(() => {
    storage.onModuleDestroy();
  });

  it('saves a PDF and reads back the same bytes and SHA-256', async () => {
    const key = `${prefix}/saved.pdf`;
    const result = await storage.upload(key, pdf, { contentType: 'application/pdf' });

    expect(result).toEqual({ key, size: pdf.length, sha256: sha256(pdf) });
    const downloaded = await storage.download(key);
    expect(downloaded.equals(pdf)).toBe(true);
    expect(sha256(downloaded)).toBe(result.sha256);
  });

  it('streams a file', async () => {
    const key = `${prefix}/streamed.pdf`;
    await storage.upload(key, pdf, { contentType: 'application/pdf' });

    const { stream, size, contentType } = await storage.downloadStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    expect(Buffer.concat(chunks).equals(pdf)).toBe(true);
    expect(size).toBe(pdf.length);
    expect(contentType).toBe('application/pdf');
  });

  it('gives a clear not-found error for a missing file', async () => {
    const key = `${prefix}/missing.pdf`;
    await expect(storage.download(key)).rejects.toThrow(StorageNotFoundError);
    await expect(storage.downloadStream(key)).rejects.toThrow(StorageNotFoundError);
    await expect(storage.download(key)).rejects.toMatchObject({ key });
    expect(await storage.exists(key)).toBe(false);

    await storage.upload(key, pdf, { contentType: 'application/pdf' });
    expect(await storage.exists(key)).toBe(true);
  });

  it('refuses a second upload to the same key and keeps the first file', async () => {
    const key = `${prefix}/once.pdf`;
    await storage.upload(key, pdf, { contentType: 'application/pdf' });

    const other = Buffer.concat([pdf, Buffer.from('% changed\n')]);
    await expect(storage.upload(key, other, { contentType: 'application/pdf' })).rejects.toThrow(
      StorageAlreadyExistsError,
    );
    expect((await storage.download(key)).equals(pdf)).toBe(true);
  });

  it('creates a download link with a Hebrew file name', async () => {
    const key = `${prefix}/linked.pdf`;
    await storage.upload(key, pdf, { contentType: 'application/pdf' });

    const link = await storage.createDownloadLink(key, { fileName: '12345_כהן-לוי.pdf' });
    const response = await fetch(link);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(pdf)).toBe(true);

    const header = response.headers.get('content-disposition') ?? '';
    expect(header).toMatch(/^attachment; /);
    const encoded = /filename\*=UTF-8''([^;]+)/.exec(header)?.[1] ?? '';
    expect(decodeURIComponent(encoded)).toBe('12345_כהן-לוי.pdf');
  });

  it('download links stop working after they expire', { timeout: 15_000 }, async () => {
    const key = `${prefix}/expiring.pdf`;
    await storage.upload(key, pdf, { contentType: 'application/pdf' });

    // The signing time is rounded down to the second, so 1 s could already be over; use 3.
    const link = await storage.createDownloadLink(key, {
      fileName: 'expiring.pdf',
      expiresInSeconds: 3,
    });
    expect((await fetch(link)).status).toBe(200);

    await sleep(4_500);
    expect((await fetch(link)).status).toBe(403);
  });

  it('refuses download links longer than 5 minutes', async () => {
    const key = `${prefix}/any.pdf`;
    await expect(
      storage.createDownloadLink(key, { fileName: 'a.pdf', expiresInSeconds: 301 }),
    ).rejects.toThrow('1–300 seconds');
    await expect(
      storage.createDownloadLink(key, { fileName: 'a.pdf', expiresInSeconds: 0 }),
    ).rejects.toThrow('1–300 seconds');
  });

  it('keeps the bucket private: an unsigned request is refused', async () => {
    const key = `${prefix}/private.pdf`;
    await storage.upload(key, pdf, { contentType: 'application/pdf' });

    const link = await storage.createDownloadLink(key, { fileName: 'private.pdf' });
    const unsigned = link.split('?')[0] ?? '';
    expect(unsigned).toContain(key);
    expect((await fetch(unsigned)).status).toBe(403);
  });

  it.each(['../x.pdf', '/x.pdf', 'a\nb.pdf', 'קובץ.pdf'])(
    'refuses the bad key %j before any request',
    async (key) => {
      await expect(storage.upload(key, pdf, { contentType: 'application/pdf' })).rejects.toThrow(
        'Invalid storage key',
      );
      await expect(storage.download(key)).rejects.toThrow('Invalid storage key');
      await expect(storage.exists(key)).rejects.toThrow('Invalid storage key');
      await expect(storage.createDownloadLink(key, { fileName: 'a.pdf' })).rejects.toThrow(
        'Invalid storage key',
      );
    },
  );
});
