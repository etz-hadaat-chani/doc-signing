import { emailTexts } from './email-texts.he.js';
import type { RenderedEmail } from './layout.js';
import { renderSigningRequest, type SigningRequestEmailData } from './signing-request.js';

/** The same request with its own subject and a new link; earlier links keep working. */
export function renderReminder(data: SigningRequestEmailData): RenderedEmail {
  const texts = emailTexts.reminder;
  return renderSigningRequest(data, {
    subject: texts.subject(data.documentName),
    intro: texts.intro(data.documentName),
    action: texts.action,
    button: texts.button,
    extra: texts.earlierLinks,
  });
}
