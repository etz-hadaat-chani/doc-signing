import type { HrContact } from '../../config/config.schema.js';
import { emailTexts } from './email-texts.he.js';
import { formatIsraelDate } from './format-date.js';
import { linkBlock, paragraph, renderLayout, type RenderedEmail } from './layout.js';

/**
 * What an invitation or reminder shows: only the name, the document name, the link and its
 * expiry date (NFR-SEC-2). There is no field for an ID number, on purpose.
 */
export interface SigningRequestEmailData {
  readonly employeeName: string;
  readonly documentName: string;
  /** From `signingLink()`. */
  readonly link: string;
  /** The round's link expiry; the line is left out when missing. */
  readonly expiresAt?: Date;
  readonly hrContact: HrContact;
  /** A correction round (FR-TRK-6): one line that a corrected document is waiting. */
  readonly correction?: boolean;
}

interface RequestTexts {
  readonly subject: string;
  readonly intro: string;
  readonly action: string;
  readonly button: string;
  /** A line right after the intro. */
  readonly lead?: string;
  readonly extra?: string;
}

/** The body the invitation and the reminder share. */
export function renderSigningRequest(
  data: SigningRequestEmailData,
  texts: RequestTexts,
): RenderedEmail {
  const greeting = emailTexts.greeting(data.employeeName);
  const expiry = data.expiresAt && emailTexts.expiry(formatIsraelDate(data.expiresAt));
  const notes = [
    emailTexts.idCheck,
    ...(expiry ? [expiry] : []),
    ...(texts.extra ? [texts.extra] : []),
  ];
  const bodyHtml = [
    paragraph(greeting),
    paragraph(texts.intro),
    ...(texts.lead ? [paragraph(texts.lead)] : []),
    paragraph(texts.action),
    linkBlock(data.link, texts.button),
    ...notes.map(paragraph),
  ].join('\n');
  const textLines = [
    greeting,
    '',
    texts.intro,
    ...(texts.lead ? [texts.lead] : []),
    texts.action,
    '',
    data.link,
    '',
    ...notes,
  ];
  return renderLayout({ subject: texts.subject, bodyHtml, textLines, hrContact: data.hrContact });
}
