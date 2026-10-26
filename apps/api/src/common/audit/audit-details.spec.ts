import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertSafeDetails, sanitizeDetails } from './audit-details.js';

describe('assertSafeDetails', () => {
  it.each([
    [{ password: 'x' }, 'details.password'],
    [{ newPassword: 'x' }, 'details.newPassword'],
    [{ token: 'x' }, 'details.token'],
    [{ tokenHash: 'x' }, 'details.tokenHash'],
    [{ idNumber: '1' }, 'details.idNumber'],
    [{ id_number: '1' }, 'details.id_number'],
    [{ employee: { IdNumber: '1' } }, 'details.employee.IdNumber'],
    [{ rows: [{ ok: 1 }, { password: 'x' }] }, 'details.rows[1].password'],
  ])('throws for a forbidden key: %j', (details, path) => {
    expect(() => {
      assertSafeDetails(details);
    }).toThrow(`"${path}"`);
  });

  it('accepts ordinary details', () => {
    expect(() => {
      assertSafeDetails({ email: 'a@b.c', userAgent: null, count: 3, ids: ['x'], fileSha256: 'f' });
    }).not.toThrow();
  });
});

describe('sanitizeDetails', () => {
  const token = randomBytes(32).toString('base64url');

  it('redacts ID numbers, tokens and signing paths in string values, at any depth', () => {
    expect(
      sanitizeDetails({
        note: 'id 012345672 typed',
        nested: { link: `https://x/sign/${token}` },
        list: [token],
      }),
    ).toEqual({
      note: 'id [redacted] typed',
      nested: { link: 'https://x/sign/[redacted]' },
      list: ['[redacted]'],
    });
  });

  it('keeps file hashes under *Sha256 keys', () => {
    const hash = 'a'.repeat(64);
    expect(sanitizeDetails({ fileSha256: hash, other: hash })).toEqual({
      fileSha256: hash,
      other: '[redacted]',
    });
  });

  it('keeps uuids whole, even with 9 digits in a row, alone or inside a longer string', () => {
    const id = '5883646f-84e9-48ea-b0fe-8e683058449e';
    expect(
      sanitizeDetails({
        importBatchId: id,
        strayFileKeys: [`rounds/${id}/15/1001.pdf`],
        note: `batch ${id}, id 012345672`,
      }),
    ).toEqual({
      importBatchId: id,
      strayFileKeys: [`rounds/${id}/15/1001.pdf`],
      note: `batch ${id}, id [redacted]`,
    });
  });

  it('leaves ordinary values as they are', () => {
    const details = { email: 'a@b.c', userAgent: null, count: 3, ok: true, name: 'ישראל ישראלי' };
    expect(sanitizeDetails(details)).toEqual(details);
  });
});
