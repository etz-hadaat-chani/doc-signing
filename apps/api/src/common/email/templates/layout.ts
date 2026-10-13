import type { HrContact } from '../../config/config.schema.js';
import { emailTexts } from './email-texts.he.js';
import { escapeHtml } from './escape-html.js';

/** One email, ready to send. */
export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

// Email clients don't load web fonts reliably; Arial and Tahoma have Hebrew everywhere.
const FONT = 'Arial, Tahoma, sans-serif';
const TEXT_COLOR = '#1f2933';
const MUTED_COLOR = '#52606d';
const BUTTON_COLOR = '#1565c0';
const BORDER_COLOR = '#dde1e6';
const LTR = 'dir="ltr" style="direction:ltr;unicode-bidi:embed;"';

/** One line for the Subject header (the mailer also blocks header injection). */
export function subjectLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim();
}

/** A paragraph of plain text (escaped here). */
export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px 0;">${escapeHtml(text)}</p>`;
}

/**
 * The link as a button (a table cell with a background color, so Outlook, which ignores padding
 * on links, still shows a button) plus the address written out, for filters and clients that
 * drop the button. The written-out link runs left to right so it reads correctly in Hebrew text.
 */
export function linkBlock(link: string, buttonLabel: string): string {
  const href = escapeHtml(link);
  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;">',
    '<tr>',
    `<td align="center" bgcolor="${BUTTON_COLOR}" style="background-color:${BUTTON_COLOR};border-radius:6px;">`,
    `<a href="${href}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:${FONT};font-size:18px;font-weight:bold;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(buttonLabel)}</a>`,
    '</td>',
    '</tr>',
    '</table>',
    `<p style="margin:0 0 16px 0;font-size:14px;color:${MUTED_COLOR};">${escapeHtml(emailTexts.linkFallback)}<br>`,
    `<span ${LTR}><a href="${href}" target="_blank" style="color:${BUTTON_COLOR};word-break:break-all;">${href}</a></span></p>`,
  ].join('\n');
}

function footerHtml(hr: HrContact): string {
  const contacts: string[] = [];
  if (hr.phone) {
    contacts.push(
      `${escapeHtml(emailTexts.footer.phone)} <span ${LTR}>${escapeHtml(hr.phone)}</span>`,
    );
  }
  if (hr.email) {
    const email = escapeHtml(hr.email);
    contacts.push(
      `${escapeHtml(emailTexts.footer.email)} <span ${LTR}><a href="mailto:${email}" style="color:${MUTED_COLOR};">${email}</a></span>`,
    );
  }
  return [
    `<p style="margin:0 0 8px 0;">${escapeHtml(emailTexts.footer.questions(hr.name))}`,
    contacts.length > 0 ? `<br>${contacts.join(' &nbsp;|&nbsp; ')}` : '',
    '</p>',
    `<p style="margin:0;">${escapeHtml(emailTexts.footer.noReply)}</p>`,
  ].join('');
}

function footerText(hr: HrContact): string[] {
  return [
    emailTexts.footer.questions(hr.name),
    ...(hr.phone ? [`${emailTexts.footer.phone} ${hr.phone}`] : []),
    ...(hr.email ? [`${emailTexts.footer.email} ${hr.email}`] : []),
    emailTexts.footer.noReply,
  ];
}

/**
 * The whole email: right to left (NFR-HEB-2), table layout with inline styles only (Outlook and
 * Gmail drop `<style>` rules in places), no images (NFR-DEL-3). `bodyHtml` is already escaped;
 * `textLines` are plain text and become the text part.
 */
export function renderLayout({
  subject,
  bodyHtml,
  textLines,
  hrContact,
}: {
  subject: string;
  bodyHtml: string;
  textLines: readonly string[];
  hrContact: HrContact;
}): RenderedEmail {
  const cleanSubject = subjectLine(subject);
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(cleanSubject)}</title>
</head>
<body dir="rtl" style="margin:0;padding:0;background-color:#f4f5f7;direction:rtl;text-align:right;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="background-color:#f4f5f7;">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid ${BORDER_COLOR};">
<tr>
<td dir="rtl" align="right" style="padding:32px 32px 16px 32px;font-family:${FONT};font-size:16px;line-height:1.6;color:${TEXT_COLOR};direction:rtl;text-align:right;">
${bodyHtml}
</td>
</tr>
<tr>
<td dir="rtl" align="right" style="padding:16px 32px 24px 32px;border-top:1px solid ${BORDER_COLOR};font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED_COLOR};direction:rtl;text-align:right;">
${footerHtml(hrContact)}
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>
`;
  const text = [...textLines, '', '--', ...footerText(hrContact), ''].join('\n');
  return { subject: cleanSubject, html, text };
}
