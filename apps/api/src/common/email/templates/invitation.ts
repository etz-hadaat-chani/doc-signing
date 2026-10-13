import { emailTexts } from './email-texts.he.js';
import type { RenderedEmail } from './layout.js';
import { renderSigningRequest, type SigningRequestEmailData } from './signing-request.js';

/** The first email of a round: document name and personal link. */
export function renderInvitation(data: SigningRequestEmailData): RenderedEmail {
  const texts = emailTexts.invitation;
  return renderSigningRequest(data, {
    subject: texts.subject(data.documentName),
    intro: texts.intro(data.documentName),
    action: texts.action,
    button: texts.button,
  });
}
