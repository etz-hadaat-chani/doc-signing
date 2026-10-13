import { describe, expect, it } from 'vitest';
import { attachmentName } from './attachment-name.js';
import { signingLink } from './signing-link.js';
import { toEmailSendError } from './smtp-email.adapter.js';
import { escapeHtml } from './templates/escape-html.js';
import { formatIsraelDate } from './templates/format-date.js';

const token = 'A'.repeat(42) + '_';

describe('escapeHtml', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('leaves Hebrew and plain text alone', () => {
    expect(escapeHtml('כהן-לוי 2')).toBe('כהן-לוי 2');
  });
});

describe('signingLink', () => {
  it('builds <url>/sign/<token>', () => {
    expect(signingLink('https://sign.example.org', token)).toBe(
      `https://sign.example.org/sign/${token}`,
    );
  });

  it('handles a trailing slash and a path', () => {
    expect(signingLink('https://example.org/app/', token)).toBe(
      `https://example.org/app/sign/${token}`,
    );
  });

  it.each(['', 'short', 'A'.repeat(44), `${'A'.repeat(42)}=`, `${'A'.repeat(42)}/`])(
    'refuses the token %j',
    (bad) => {
      expect(() => signingLink('https://sign.example.org', bad)).toThrow('Invalid signing token');
    },
  );

  it('never quotes the token in its error', () => {
    const almost = `${'B'.repeat(42)}!`;
    expect(() => signingLink('https://sign.example.org', almost)).not.toThrow(almost);
  });
});

describe('attachmentName', () => {
  it('keeps a Hebrew name', () => {
    expect(attachmentName('הצהרת סודיות - ישראל כהן-לוי.pdf')).toBe(
      'הצהרת סודיות - ישראל כהן-לוי.pdf',
    );
  });

  it('removes characters Windows refuses and control characters', () => {
    expect(attachmentName('a/b\\c:d*e?f"g<h>i|j\r\nk.pdf')).toBe('abcdefghijk.pdf');
  });

  it('adds .pdf once', () => {
    expect(attachmentName('מסמך')).toBe('מסמך.pdf');
    expect(attachmentName('מסמך.PDF')).toBe('מסמך.pdf');
    expect(attachmentName('מסמך. ')).toBe('מסמך.pdf');
  });

  it('falls back when nothing is left', () => {
    expect(attachmentName('')).toBe('document.pdf');
    expect(attachmentName('///.pdf')).toBe('document.pdf');
  });
});

describe('formatIsraelDate', () => {
  it('formats DD/MM/YYYY', () => {
    expect(formatIsraelDate(new Date('2026-12-12T10:00:00Z'))).toBe('12/12/2026');
    expect(formatIsraelDate(new Date('2027-01-05T10:00:00Z'))).toBe('05/01/2027');
  });

  it('shows the Israeli date near midnight UTC', () => {
    // Winter, UTC+2: 22:30 UTC is already 00:30 the next day in Israel.
    expect(formatIsraelDate(new Date('2026-12-11T22:30:00Z'))).toBe('12/12/2026');
    // 21:59 UTC is 23:59 in Israel: still the same day.
    expect(formatIsraelDate(new Date('2026-12-11T21:59:00Z'))).toBe('11/12/2026');
    // Summer, UTC+3: 21:30 UTC is 00:30 the next day.
    expect(formatIsraelDate(new Date('2026-07-14T21:30:00Z'))).toBe('15/07/2026');
  });
});

describe('toEmailSendError', () => {
  /** An error shaped like nodemailer's. */
  function smtpError(fields: { responseCode?: number; command?: string; code?: string }) {
    return Object.assign(
      new Error('Recipient command failed: 550 5.1.1 <someone@example.com>: unknown user'),
      fields,
    );
  }

  it.each([
    [{ responseCode: 550, command: 'RCPT TO', code: 'EENVELOPE' }, 'permanent', '550'],
    [{ responseCode: 554, command: 'DATA', code: 'EMESSAGE' }, 'permanent', '554'],
    [{ code: 'EENVELOPE' }, 'permanent', 'EENVELOPE'],
    [{ responseCode: 421, command: 'CONN' }, 'temporary', '421'],
    [{ responseCode: 451, command: 'RCPT TO', code: 'EENVELOPE' }, 'temporary', '451'],
    [{ responseCode: 535, command: 'AUTH PLAIN', code: 'EAUTH' }, 'temporary', '535'],
    [{ code: 'ECONNECTION' }, 'temporary', 'ECONNECTION'],
    [{ code: 'ETIMEDOUT' }, 'temporary', 'ETIMEDOUT'],
  ] as const)('maps %j to %s', (fields, kind, providerCode) => {
    const error = toEmailSendError(smtpError(fields));
    expect(error).toMatchObject({ name: 'EmailSendError', kind, providerCode });
  });

  it('treats an unknown error as temporary', () => {
    expect(toEmailSendError('boom')).toMatchObject({ kind: 'temporary', providerCode: undefined });
    expect(toEmailSendError(null)).toMatchObject({ kind: 'temporary' });
  });

  it('never carries the recipient or the original message', () => {
    const error = toEmailSendError(smtpError({ responseCode: 550, command: 'RCPT TO' }));
    expect(error.message).toBe('Email send failed (permanent, 550)');
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('someone@example.com');
  });
});
