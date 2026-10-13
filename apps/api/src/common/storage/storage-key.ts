const MAX_KEY_BYTES = 1024;

/**
 * Checks a storage key. Keys are ASCII only (ids and numbers, e.g.
 * `rounds/<roundId>/<departmentCode>/<employeeNumber>.pdf`); Hebrew names appear only in
 * download names and the ZIP. Keys are built by code, so a bad one is a bug: throws.
 */
export function assertValidStorageKey(key: string): void {
  const problem = storageKeyProblem(key);
  if (problem) {
    throw new Error(`Invalid storage key (${problem})`);
  }
}

function storageKeyProblem(key: string): string | undefined {
  if (key.length === 0) return 'empty';
  if (Buffer.byteLength(key) > MAX_KEY_BYTES) return 'too long';
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(key)) return 'control character';
  if (key.startsWith('/')) return 'leading slash';
  if (key.endsWith('/') || key.includes('//')) return 'empty path segment';
  if (key.includes('..')) return '".."';
  if (!/^[A-Za-z0-9._/-]+$/.test(key)) return 'only A-Z a-z 0-9 . _ - / allowed';
  return undefined;
}
