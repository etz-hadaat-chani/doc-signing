import type { HrContact } from '../../config/config.schema.js';
import { emailTexts } from './email-texts.he.js';
import { paragraph, renderLayout, type RenderedEmail } from './layout.js';

/** Sent after signing, with the signed PDF attached. No link and no ID number. */
export interface SignedCopyEmailData {
  readonly employeeName: string;
  readonly documentName: string;
  readonly hrContact: HrContact;
}

export function renderSignedCopy(data: SignedCopyEmailData): RenderedEmail {
  const texts = emailTexts.signedCopy;
  const greeting = emailTexts.greeting(data.employeeName);
  const intro = texts.intro(data.documentName);
  return renderLayout({
    subject: texts.subject(data.documentName),
    bodyHtml: [paragraph(greeting), paragraph(intro), paragraph(texts.attached)].join('\n'),
    textLines: [greeting, '', intro, texts.attached],
    hrContact: data.hrContact,
  });
}
