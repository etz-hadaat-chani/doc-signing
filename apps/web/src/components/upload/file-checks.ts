import { he } from '../../i18n/he';

export interface AcceptedFiles {
  /** File name endings, e.g. `['.xlsx']`, matched ignoring case. */
  extensions: readonly string[];
  /** How the user reads them, e.g. "Excel (.xlsx)". */
  label: string;
}

const KB = 1024;
const MB = 1024 * KB;

/** "340 ק״ב" / "1.2 מ״ב". */
export function formatFileSize(bytes: number): string {
  if (bytes < MB) return he.upload.kilobytes(String(Math.max(1, Math.round(bytes / KB))));
  return he.upload.megabytes(String(Number((bytes / MB).toFixed(1))));
}

/**
 * Checks the chosen files before the parent gets one (null: nothing was chosen). Only a convenience for the user (a quick
 * Hebrew message): the server checks the real content and size again.
 */
export function checkFiles(
  files: readonly File[],
  accept: AcceptedFiles,
  maxBytes: number,
): { file: File } | { error: string } | null {
  const [file] = files;
  if (!file) return null;
  if (files.length > 1) return { error: he.upload.tooMany };
  const name = file.name.toLowerCase();
  if (!accept.extensions.some((extension) => name.endsWith(extension.toLowerCase()))) {
    return { error: he.upload.wrongType(accept.label) };
  }
  if (file.size === 0) return { error: he.upload.empty };
  if (file.size > maxBytes) return { error: he.upload.tooLarge(formatFileSize(maxBytes)) };
  return { file };
}
