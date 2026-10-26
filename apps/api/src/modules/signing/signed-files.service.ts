import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { StorageAdapter } from '../../common/storage/storage.adapter.js';
import { StorageAlreadyExistsError } from '../../common/storage/storage.errors.js';

/** At most this many tries of one file (`<name>.pdf`, `<name>-2.pdf` …); more is a bug. */
const MAX_VERSIONS = 20;

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Where a file ended up. */
export interface StoredFile {
  key: string;
  /** SHA-256 of the bytes in storage (NFR-SIG-2), not of a freshly built copy. */
  sha256: string;
  size: number;
  /** An earlier try of this same submission had already stored it. */
  reused: boolean;
  /** Keys of earlier tries with different content, left in storage (no delete). */
  strayKeys: string[];
}

export interface StoredPdf<T> extends StoredFile {
  /** The build that matches the stored file (its answers are the ones to save). */
  built: T;
  /** Its signing time: the one written in the stored file. */
  signedAt: Date;
}

/** The `-n` name of the n-th try: `a/b/1001.pdf` → `a/b/1001-2.pdf`. */
export function versionKey(key: string, version: number): string {
  if (version === 1) return key;
  const dot = key.lastIndexOf('.');
  return `${key.slice(0, dot)}-${String(version)}${key.slice(dot)}`;
}

/** The signing time a signed PDF carries (`sealPdf` writes it as the creation date). */
async function signingTimeOf(pdf: Uint8Array): Promise<Date | null> {
  try {
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    return doc.getCreationDate() ?? null;
  } catch {
    return null;
  }
}

/**
 * Stores the signed PDF and the drawings (3.13) without ever overwriting (2.5). A file already
 * at the key comes from an earlier try that didn't finish (a crash, a lost answer, two clicks):
 * - The same content → kept as it is; its own hash is what the assignment stores (TASKS 3.13).
 *   For the PDF "the same" means: built again with the stored file's signing time, the bytes
 *   are equal (the same input gives the same bytes, 3.7).
 * - Different content (she changed an answer) → the next free `-n` key; the earlier file stays
 *   and is reported as stray, so the stored file always matches the saved answers.
 */
@Injectable()
export class SignedFilesService {
  constructor(private readonly storage: StorageAdapter) {}

  /** A drawing (PNG) at `key`, or its next free `-n` version. */
  storeImage(key: string, png: Uint8Array): Promise<StoredFile> {
    return this.storeFile(key, png, 'image/png');
  }

  /**
   * A file stored as it is (a drawing, a scanned paper document, 3.16) at `key`, or its next free
   * `-n` version: the same bytes already there → kept (a retry); other bytes → left, next key.
   */
  async storeFile(key: string, bytes: Uint8Array, contentType: string): Promise<StoredFile> {
    const strayKeys: string[] = [];
    for (let version = 1; version <= MAX_VERSIONS; version++) {
      const target = versionKey(key, version);
      const stored = await this.tryUpload(target, bytes, contentType);
      if (stored) return { ...stored, reused: false, strayKeys };
      const existing = await this.storage.download(target);
      if (Buffer.from(bytes).equals(existing)) {
        return {
          key: target,
          sha256: sha256(existing),
          size: existing.length,
          reused: true,
          strayKeys,
        };
      }
      strayKeys.push(target);
    }
    throw new Error('Too many stored versions of a file');
  }

  /**
   * The signed PDF at `key`, or its next free `-n` version. `build(signedAt)` makes the PDF for
   * a signing time; `first` is its result for this try's time.
   */
  async storePdf<T extends { pdf: Uint8Array }>(
    key: string,
    first: T,
    signedAt: Date,
    build: (signedAt: Date) => Promise<T>,
  ): Promise<StoredPdf<T>> {
    const strayKeys: string[] = [];
    for (let version = 1; version <= MAX_VERSIONS; version++) {
      const target = versionKey(key, version);
      const stored = await this.tryUpload(target, first.pdf, 'application/pdf');
      if (stored) return { ...stored, reused: false, strayKeys, built: first, signedAt };
      const existing = await this.storage.download(target);
      const match = await this.sameSubmission(existing, first, signedAt, build);
      if (match) {
        const { built, at } = match;
        return {
          key: target,
          sha256: sha256(existing),
          size: existing.length,
          reused: true,
          strayKeys,
          built,
          signedAt: at,
        };
      }
      strayKeys.push(target);
    }
    throw new Error('Too many stored versions of a signed document');
  }

  /** The upload, or null when a file is already there. */
  private async tryUpload(key: string, body: Uint8Array, contentType: string) {
    try {
      const result = await this.storage.upload(key, Buffer.from(body), { contentType });
      return { key, sha256: result.sha256, size: result.size };
    } catch (error) {
      if (error instanceof StorageAlreadyExistsError) return null;
      throw error;
    }
  }

  /** Whether the stored PDF is this submission, built at the time written in it. */
  private async sameSubmission<T extends { pdf: Uint8Array }>(
    existing: Buffer,
    first: T,
    signedAt: Date,
    build: (signedAt: Date) => Promise<T>,
  ): Promise<{ built: T; at: Date } | null> {
    const at = await signingTimeOf(existing);
    if (!at) return null;
    let built: T;
    try {
      built = at.getTime() === signedAt.getTime() ? first : await build(at);
    } catch {
      // Not buildable at that time (e.g. a date limit of that day): not this submission.
      return null;
    }
    return Buffer.from(built.pdf).equals(existing) ? { built, at } : null;
  }
}
