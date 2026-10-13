import type { Readable } from 'node:stream';

export interface UploadOptions {
  readonly contentType: string;
}

export interface UploadResult {
  readonly key: string;
  readonly size: number;
  /** SHA-256 of the uploaded bytes, lowercase hex (64 characters). */
  readonly sha256: string;
}

export interface DownloadStream {
  readonly stream: Readable;
  readonly size: number | undefined;
  readonly contentType: string | undefined;
}

export interface DownloadLinkOptions {
  /** Name the browser saves the file as; Hebrew is fine. */
  readonly fileName: string;
  readonly disposition?: 'attachment' | 'inline';
  /** 1 to MAX_DOWNLOAD_LINK_SECONDS; default MAX_DOWNLOAD_LINK_SECONDS. */
  readonly expiresInSeconds?: number;
}

/** Download links last at most 5 minutes. */
export const MAX_DOWNLOAD_LINK_SECONDS = 300;

/**
 * Private file storage. Injected by class: `constructor(private readonly storage: StorageAdapter)`.
 * Keys must pass `assertValidStorageKey`. Errors: `StorageNotFoundError`,
 * `StorageAlreadyExistsError`. No delete on purpose: signed documents are never deleted.
 */
export abstract class StorageAdapter {
  /** Saves a file. Never overwrites: an existing key throws `StorageAlreadyExistsError`. */
  abstract upload(key: string, body: Buffer, options: UploadOptions): Promise<UploadResult>;

  /** Whole file in memory; for small files. Use `downloadStream` for big files and the ZIP. */
  abstract download(key: string): Promise<Buffer>;

  abstract downloadStream(key: string): Promise<DownloadStream>;

  abstract exists(key: string): Promise<boolean>;

  /** Short-lived signed link straight to the storage (no permission check of its own). */
  abstract createDownloadLink(key: string, options: DownloadLinkOptions): Promise<string>;
}
