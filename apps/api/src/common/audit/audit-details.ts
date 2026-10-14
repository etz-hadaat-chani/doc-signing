import type { Prisma } from '../../generated/prisma/client.js';
import { redactForLog } from '../errors/redact.js';

/** Key names that must never reach the log, at any depth (case-insensitive, ignoring `_`). */
const FORBIDDEN_KEY = /password|token|idnumber/;

/** Values under these keys are file hashes on purpose (NFR-SIG-2) and skip the value check. */
const HASH_KEY = /Sha256$/;

/**
 * A value that is exactly one uuid (e.g. `importBatchId`) is a record id, never personal data.
 * Kept as is: its last group can hold 9 digits in a row, which would look like an ID number.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Throws when a key looks like a password, link token or ID number. Such a key is a coding bug,
 * so it fails loudly (and rolls back the transaction the log row is part of).
 */
export function assertSafeDetails(value: unknown, path = 'details'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertSafeDetails(item, `${path}[${index}]`);
    });
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key.toLowerCase().replaceAll('_', ''))) {
      throw new Error(`Audit details must not contain "${path}.${key}"`);
    }
    assertSafeDetails(item, `${path}.${key}`);
  }
}

/**
 * Runs every string value through redactForLog (ID numbers, tokens, signing paths), at any
 * depth. Data-dependent, so it redacts instead of throwing.
 */
export function sanitizeDetails(details: object): Prisma.InputJsonObject {
  return sanitizeValue(details) as Prisma.InputJsonObject;
}

function sanitizeValue(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    return HASH_KEY.test(key) || UUID.test(value) ? value : redactForLog(value);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, sanitizeValue(item, name)]),
    );
  }
  return value;
}
