import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { SavedEmployerSignature } from '@doc-signing/shared';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';
import { StorageAdapter } from '../../common/storage/storage.adapter.js';
import { ByteCache } from './byte-cache.js';
import { TextFont } from './pdf-text.js';

/** The embedded font: Heebo Regular (SIL OFL 1.1, see assets/fonts/README.md). */
export const FONT_FILE = new URL('../../assets/fonts/Heebo-Regular.ttf', import.meta.url);

/** Template PDFs are at most 10 MB each; real use is a few dozen templates. */
const TEMPLATE_CACHE_BYTES = 100 * 1024 * 1024;
/** Signature images are at most 1 MB each (3.18). */
const IMAGE_CACHE_BYTES = 20 * 1024 * 1024;

/** An image with its SHA-256, worked out once when it is read from storage. */
interface HashedImage {
  bytes: Uint8Array;
  sha256: string;
  byteLength: number;
}

/**
 * What every PDF is drawn with: the font (read once at start-up) and the stored files, read
 * through an in-memory cache by storage key. Keys are never overwritten (2.5, 3.18), so a cached
 * file is always the stored one; at most 100 MB of templates and 20 MB of images are kept.
 */
@Injectable()
export class PdfAssetsService implements OnModuleInit {
  private textFont: TextFont | null = null;
  private readonly templates = new ByteCache<Uint8Array>(TEMPLATE_CACHE_BYTES);
  private readonly images = new ByteCache<HashedImage>(IMAGE_CACHE_BYTES);

  constructor(private readonly storage: StorageAdapter) {}

  async onModuleInit(): Promise<void> {
    this.textFont = new TextFont(await readFile(FONT_FILE));
  }

  get font(): TextFont {
    if (!this.textFont) throw new Error('PdfAssetsService used before start-up');
    return this.textFont;
  }

  /** A template's original PDF. */
  templatePdf(fileKey: string): Promise<Uint8Array> {
    return this.templates.getOrLoad(fileKey, async () => this.storage.download(fileKey));
  }

  /**
   * The employer signature image a document was given (its key and hash are in the values). The
   * file must have the saved SHA-256: a different file is a clear error, never a wrong image.
   */
  async employerSignature(saved: SavedEmployerSignature): Promise<Uint8Array> {
    const image = await this.images.getOrLoad(saved.fileKey, async () => {
      const bytes = await this.storage.download(saved.fileKey);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      return { bytes, sha256, byteLength: bytes.byteLength };
    });
    if (image.sha256 !== saved.sha256) {
      throw new AppException('EMPLOYER_SIGNATURE_IMAGE_MISMATCH', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return image.bytes;
  }
}
