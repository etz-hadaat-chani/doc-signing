import { emailTexts } from './email-texts.he.js';
import type { RenderedEmail } from './layout.js';
import { renderSigningRequest, type SigningRequestEmailData } from './signing-request.js';

/**
 * The first email of a round: document name and personal link. A correction round (FR-TRK-6)
 * adds one line that a corrected document is waiting; never the manager's note (it is shown only
 * on the signing screen, after the ID check).
 */
export function renderInvitation(data: SigningRequestEmailData): RenderedEmail {
  const texts = emailTexts.invitation;
  return renderSigningRequest(data, {
    subject: texts.subject(data.documentName),
    intro: texts.intro(data.documentName),
    ...(data.correction && { lead: texts.correction }),
    action: texts.action,
    button: texts.button,
  });
}
