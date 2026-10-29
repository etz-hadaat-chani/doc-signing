import type { SignHrContact, SignLinkState } from '@doc-signing/shared';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { isApiRequestError } from '../api/api-error';
import { ErrorState } from '../components/feedback/ErrorState';
import { errorContent } from '../components/feedback/error-content';
import { PageLoader } from '../components/feedback/PageLoader';
import { he } from '../i18n/he';
import { MessagePage, type SignMessageKind } from './MessagePage';
import { linkState } from './sign.api';
import { SignLayout } from './SignLayout';

type View =
  | { kind: 'loading' }
  | { kind: 'failed'; error: unknown }
  | { kind: 'message'; message: SignMessageKind; hrContact: SignHrContact | null }
  | { kind: 'valid'; hrContact: SignHrContact };

/** The B5 screen of a link state that can't be signed. */
const MESSAGE_OF: Record<Exclude<SignLinkState, 'valid'>, SignMessageKind> = {
  signed: 'signed',
  cancelled: 'cancelled',
  expired: 'expired',
  locked: 'locked',
};

/**
 * `/sign/:token` (6.1, FR-SGN-1, FR-SGN-7): asks `GET /api/sign/:token` once (state only) and
 * shows B5 for a state that can't be signed, or "the link is not valid" for a 404. Plain state,
 * no query cache: the token never sits in the data cache and a focus never asks again.
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

  const retry = () => {
    setView({ kind: 'loading' });
    setAttempt((n) => n + 1);
  };

  return (
    <SignLayout>
      {view.kind === 'loading' && <PageLoader />}
      {view.kind === 'failed' && <ErrorState {...errorContent(view.error)} onRetry={retry} />}
      {view.kind === 'message' && <MessagePage kind={view.message} hrContact={view.hrContact} />}
      {view.kind === 'valid' && <Typography>{he.sign.idCheckNext}</Typography>}
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
