import { describe, expect, it } from 'vitest';
import type { HrContact } from '../../config/config.schema.js';
import { signingLink } from '../signing-link.js';
import { renderInvitation } from './invitation.js';
import type { RenderedEmail } from './layout.js';
import { renderReminder } from './reminder.js';
import { renderSignedCopy } from './signed-copy.js';

// A fixed token without 9 digits in a row, so the "no ID number" check can't hit it by chance.
const token = 'Ab_cd-EfGhIjKlMnOpQrStUvWxYzabcdefghijklmno';
const link = signingLink('https://sign.example.org', token);
const hrContact: HrContact = {
  name: 'מחלקת משאבי אנוש',
  phone: '02-1234567',
  email: 'hr@example.org',
};
const realistic = { employeeName: 'ישראל כהן-לוי 2', documentName: 'הצהרת סודיות 2026', hrContact };
const hostile = { employeeName: '<script>&"\'', documentName: '<b>מסמך</b>', hrContact };

const nineDigits = /(?<!\d)\d{9}(?!\d)/;

const templates: [string, (data: typeof realistic) => RenderedEmail, boolean][] = [
  ['invitation', (data) => renderInvitation({ ...data, link }), true],
  ['reminder', (data) => renderReminder({ ...data, link }), true],
  ['signed copy', (data) => renderSignedCopy(data), false],
];

describe.each(templates)('%s email', (_name, render, hasLink) => {
  const email = render(realistic);

  it('is Hebrew HTML, right to left', () => {
    expect(email.html).toMatch(/^<!DOCTYPE html>/);
    expect(email.html).toContain('<html dir="rtl" lang="he">');
    expect(email.html).toContain('<meta charset="utf-8">');
    expect(email.html).toMatch(/<body dir="rtl" style="[^"]*direction:rtl/);
    expect(email.html).not.toMatch(/<img|<style|<script|class=/);
  });

  it('greets the employee by name and names the document', () => {
    for (const part of [email.html, email.text]) {
      expect(part).toContain('שלום ישראל כהן-לוי 2,');
      expect(part).toContain('הצהרת סודיות 2026');
    }
    expect(email.subject).toContain('הצהרת סודיות 2026');
  });

  it('escapes every inserted value', () => {
    const escaped = render(hostile);
    expect(escaped.html).toContain('&lt;script&gt;&amp;&quot;&#39;');
    expect(escaped.html).toContain('&lt;b&gt;מסמך&lt;/b&gt;');
    expect(escaped.html).not.toContain('<script>');
    expect(escaped.html).not.toContain('<b>');
    // The text part is plain text: nothing to escape.
    expect(escaped.text).toContain('<script>&"\'');
  });

  it('has a plain-text version', () => {
    expect(email.text.length).toBeGreaterThan(50);
    expect(email.text).not.toMatch(/<[a-z]/i);
  });

  it('carries no ID number', () => {
    expect(email.subject).not.toMatch(nineDigits);
    expect(email.html).not.toMatch(nineDigits);
    expect(email.text).not.toMatch(nineDigits);
  });

  it('ends with the HR contact details', () => {
    for (const part of [email.html, email.text]) {
      expect(part).toContain('לשאלות אפשר לפנות אל מחלקת משאבי אנוש');
      expect(part).toContain('02-1234567');
      expect(part).toContain('hr@example.org');
    }
  });

  it.runIf(hasLink)('has the link as a button and written out', () => {
    const hrefs = [...email.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs.filter((href) => href === link)).toHaveLength(2);
    expect(email.html).toContain(`>${link}</a>`);
    expect(email.html).toMatch(/<span dir="ltr"[^>]*><a href="[^"]+"[^>]*>https:/);
    expect(email.text.split('\n')).toContain(link);
  });

  it.runIf(!hasLink)('has no link, only the attachment note', () => {
    expect(email.html).not.toContain('/sign/');
    expect(email.text).not.toContain('/sign/');
    expect(email.text).toContain('מצורף');
  });
});

// 7.3: made-up names and template names with hyphens, quotes, numbers, Latin and brackets.
describe.each(templates)('%s email with tricky Hebrew names', (_name, render) => {
  it.each([
    ['שרה-לאה בן-דוד', 'חוזה 2026-2027 (מחליפה)'],
    ["ג׳ורג׳ צ'רניחובסקי", "הצהרת סודיות - נוסח ב'"],
    ['דוד 2 רמח״ל', 'נוהל צה"ל 2026'],
    ['מיכל Smith', 'טופס 101 - IT'],
  ])('%s / %s: kept in the text and subject, escaped in the HTML', (employeeName, documentName) => {
    const email = render({ employeeName, documentName, hrContact });
    const html = (value: string) => value.replaceAll("'", '&#39;').replaceAll('"', '&quot;');
    expect(email.text).toContain(`שלום ${employeeName},`);
    expect(email.text).toContain(documentName);
    expect(email.html).toContain(`שלום ${html(employeeName)},`);
    expect(email.html).toContain(html(documentName));
    expect(email.subject).toContain(documentName);
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});

describe('subjects', () => {
  it('gives the reminder a different subject from the invitation', () => {
    const invitation = renderInvitation({ ...realistic, link });
    const reminder = renderReminder({ ...realistic, link });
    expect(invitation.subject).toBe('מסמך לחתימה: הצהרת סודיות 2026');
    expect(reminder.subject).not.toBe(invitation.subject);
    expect(reminder.subject).toMatch(/^תזכורת/);
  });

  it('keeps a subject on one line', () => {
    const email = renderInvitation({
      ...realistic,
      documentName: 'שורה\r\nBcc: x@example.com',
      link,
    });
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});

describe('link expiry', () => {
  const expiresAt = new Date('2026-12-12T10:00:00Z');

  it.each([
    ['invitation', renderInvitation],
    ['reminder', renderReminder],
  ])('the %s shows the expiry date when given', (_name, render) => {
    const email = render({ ...realistic, link, expiresAt });
    expect(email.html).toContain('הקישור בתוקף עד 12/12/2026.');
    expect(email.text).toContain('הקישור בתוקף עד 12/12/2026.');
  });

  it.each([
    ['invitation', renderInvitation],
    ['reminder', renderReminder],
  ])('the %s leaves the line out without a date', (_name, render) => {
    const email = render({ ...realistic, link });
    expect(email.html).not.toContain('בתוקף עד');
    expect(email.text).not.toContain('בתוקף עד');
  });
});

describe('footer', () => {
  it('shows only the contact details that are set', () => {
    const email = renderSignedCopy({ ...realistic, hrContact: { ...hrContact, phone: undefined } });
    expect(email.text).not.toContain('טלפון');
    expect(email.text).toContain('hr@example.org');
  });
});
