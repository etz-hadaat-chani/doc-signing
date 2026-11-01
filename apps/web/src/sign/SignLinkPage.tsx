import type { SignHrContact, SignLinkState } from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { isApiRequestError } from '../api/api-error';
import { ErrorState } from '../components/feedback/ErrorState';
import { errorContent } from '../components/feedback/error-content';
import { PageLoader } from '../components/feedback/PageLoader';
import { he } from '../i18n/he';
import { DocumentStep } from './DocumentStep';
import { DoneScreen } from './DoneScreen';
import { EMPTY_DRAFT, type FormDraft } from './form/form-draft';
import { FormStep } from './FormStep';
import type { VerifyOutcome } from './id-check-outcome';
import { IdCheck } from './IdCheck';
import { MessagePage, type SignMessageKind } from './MessagePage';
import { sessionDeadline } from './session-deadline';
import { SessionWarning } from './SessionWarning';
import { linkDocument, linkFit, linkForm, linkState, linkSubmit, verifyLink } from './sign.api';
import { SignLayout } from './SignLayout';

type View =
  | { kind: 'loading' }
  | { kind: 'failed'; error: unknown }
  | { kind: 'message'; message: SignMessageKind; hrContact: SignHrContact | null }
  | { kind: 'valid'; hrContact: SignHrContact }
  | { kind: 'document'; hrContact: SignHrContact }
  /** The session ended on B2 or B3: the ID number again, then back where she was. */
  | { kind: 'reverify'; hrContact: SignHrContact; then: 'document' | 'form' }
  | { kind: 'form'; hrContact: SignHrContact }
  /** B4. `copy`: false when it was found already signed (no copy is promised then). */
  | { kind: 'done'; hrContact: SignHrContact; copy: boolean };

/** The B5 screen of a link state that can't be signed. */
const MESSAGE_OF: Record<Exclude<SignLinkState, 'valid'>, SignMessageKind> = {
  signed: 'signed',
  cancelled: 'cancelled',
  expired: 'expired',
  locked: 'locked',
};

/**
 * `/sign/:token` (6.1–6.3, FR-SGN-1–3, FR-SGN-7): asks `GET /api/sign/:token` once (state
 * only) and shows B5 for a state that can't be signed, "the link is not valid" for a 404, or B1
 * for a valid link; the correct ID number opens B2. A refusal at any step (locked, signed
 * meanwhile …) shows B5 with the contact already read; a session that ended on B2 asks the ID
 * number again and goes back there (on B3 with every answer kept). Plain state, no query cache:
 * the token and her answers never sit in the data cache, and a focus never asks again. Two
 * minutes before the session ends a calm notice says so. Signed → B4, and her answers and
 * signature are dropped; the link then reads "already signed" (6.1).
 */
export function SignLinkPage() {
  const { token = '' } = useParams();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Her B3 answers: here, above the ID check, so a session that ends keeps them (FR-SGN-8).
  const [draft, setDraft] = useState<FormDraft>(EMPTY_DRAFT);
  // When the signing session ends (this computer's clock), for the notice before it does.
  const [deadline, setDeadline] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    linkState(token, controller.signal).then(
      ({ state, hrContact }) =>
        setView(
          state === 'valid'
            ? { kind: 'valid', hrContact }
            : { kind: 'message', message: MESSAGE_OF[state], hrContact },
        ),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (isApiRequestError(error) && error.status === 404) {
          setView({ kind: 'message', message: 'notFound', hrContact: null });
        } else {
          setView({ kind: 'failed', error });
        }
      },
    );
    return () => controller.abort();
  }, [token, attempt]);

  const refused = (outcome: Exclude<VerifyOutcome, { kind: 'retry' }>, hrContact: SignHrContact) =>
    setView({
      kind: 'message',
      message: outcome.kind === 'gone' ? 'notFound' : MESSAGE_OF[outcome.state],
      hrContact,
    });

  const retry = () => {
    setView({ kind: 'loading' });
    setAttempt((n) => n + 1);
  };

  return (
    <SignLayout wide={view.kind === 'document'}>
      {view.kind === 'loading' && <PageLoader />}
      {view.kind === 'failed' && <ErrorState {...errorContent(view.error)} onRetry={retry} />}
      {view.kind === 'message' && <MessagePage kind={view.message} hrContact={view.hrContact} />}
      {(view.kind === 'valid' || view.kind === 'reverify') && (
        <IdCheck
          key={view.kind}
          verify={(idNumber) => verifyLink(token, idNumber)}
          onVerified={(result) => {
            setDeadline(sessionDeadline(result));
            setView({
              kind: view.kind === 'reverify' ? view.then : 'document',
              hrContact: view.hrContact,
            });
          }}
          onRefused={(outcome) => refused(outcome, view.hrContact)}
          notice={
            view.kind === 'reverify' && (
              <Alert severity="info" role="alert">
                {he.sign.document.sessionEnded}
              </Alert>
            )
          }
        />
      )}
      {(view.kind === 'document' || view.kind === 'form') && (
        <SessionWarning deadline={deadline} channel="link" />
      )}
      {view.kind === 'document' && (
        <DocumentStep
          load={(signal) => linkDocument(token, signal)}
          onContinue={() => setView({ kind: 'form', hrContact: view.hrContact })}
          onSessionEnded={() =>
            setView({ kind: 'reverify', hrContact: view.hrContact, then: 'document' })
          }
          onRefused={(outcome) => refused(outcome, view.hrContact)}
        />
      )}
      {view.kind === 'form' && (
        <FormStep
          load={(signal) => linkForm(token, signal)}
          fit={(answers, signal) => linkFit(token, answers, signal)}
          submit={(body) => linkSubmit(token, body)}
          onSigned={(kind) => {
            setDraft(EMPTY_DRAFT);
            setDeadline(null);
            setView({ kind: 'done', hrContact: view.hrContact, copy: kind === 'signed' });
          }}
          draft={draft}
          onDraftChange={setDraft}
          onSessionEnded={() =>
            setView({ kind: 'reverify', hrContact: view.hrContact, then: 'form' })
          }
          onRefused={(outcome) => refused(outcome, view.hrContact)}
        />
      )}
      {view.kind === 'done' && (
        <DoneScreen copy={view.copy ? 'link' : 'none'} hrContact={view.hrContact} />
      )}
    </SignLayout>
  );
}

/** `/sign` without a token, or a longer path: the same "not valid" screen, no request. */
export function SignNotFoundPage() {
  return (
    <SignLayout>
      <MessagePage kind="notFound" hrContact={null} />
    </SignLayout>
  );
}
