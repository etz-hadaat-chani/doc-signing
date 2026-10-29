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
import { FormStepPlaceholder } from './FormStepPlaceholder';
import type { VerifyOutcome } from './id-check-outcome';
import { IdCheck } from './IdCheck';
import { MessagePage, type SignMessageKind } from './MessagePage';
import { linkDocument, linkState, verifyLink } from './sign.api';
import { SignLayout } from './SignLayout';

type View =
  | { kind: 'loading' }
  | { kind: 'failed'; error: unknown }
  | { kind: 'message'; message: SignMessageKind; hrContact: SignHrContact | null }
  | { kind: 'valid'; hrContact: SignHrContact }
  | { kind: 'document'; hrContact: SignHrContact }
  /** The session ended on B2: the ID number again, then back to the document. */
  | { kind: 'reverify'; hrContact: SignHrContact }
  | { kind: 'form' };

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
 * number again and goes back to the document. Plain state, no query cache: the token never sits in the data cache
 * and a focus never asks again.
 */
export function SignLinkPage() {
  const { token = '' } = useParams();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

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
          onVerified={() => setView({ kind: 'document', hrContact: view.hrContact })}
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
      {view.kind === 'document' && (
        <DocumentStep
          load={(signal) => linkDocument(token, signal)}
          onContinue={() => setView({ kind: 'form' })}
          onSessionEnded={() => setView({ kind: 'reverify', hrContact: view.hrContact })}
          onRefused={(outcome) => refused(outcome, view.hrContact)}
        />
      )}
      {view.kind === 'form' && <FormStepPlaceholder />}
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
