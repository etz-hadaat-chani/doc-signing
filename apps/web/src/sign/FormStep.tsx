import type { SignFormResult } from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { type Dispatch, type SetStateAction, useEffect, useEffectEvent, useState } from 'react';
import { ErrorState } from '../components/feedback/ErrorState';
import { errorContent } from '../components/feedback/error-content';
import { PageLoader } from '../components/feedback/PageLoader';
import { he } from '../i18n/he';
import { documentOutcome, type DocumentOutcome } from './document-outcome';
import type { FormDraft } from './form/form-draft';
import { SignForm } from './form/SignForm';
import type { FitCall } from './form/use-fit-check';

type Fetched =
  | { kind: 'loading' }
  | { kind: 'ready'; form: SignFormResult }
  | { kind: 'wait'; seconds: number | null; message: string }
  | { kind: 'failed'; error: unknown };

interface FormStepProps {
  /** `GET …/form` of a link or of the office computer, with the session cookie only. */
  load: (signal: AbortSignal) => Promise<SignFormResult>;
  /** `POST …/fit` of the same channel. */
  fit: FitCall;
  /** Her answers, kept by the page (so a new ID check keeps them). */
  draft: FormDraft;
  onDraftChange: Dispatch<SetStateAction<FormDraft>>;
  /** 401 `SIGN_SESSION_EXPIRED`. */
  onSessionEnded: () => void;
  /** The document can't be signed (any more): the caller shows the B5 screen. */
  onRefused: (outcome: Extract<DocumentOutcome, { kind: 'refused' | 'gone' }>) => void;
}

/**
 * B3 (FR-SGN-4): reads the form once (plain state, no data cache) and shows it from the top
 * (B2 left the page scrolled to its end). The same answers as B2: a session that ended, a
 * refusal (B5), a 429 wait, or "try again".
 */
export function FormStep(props: FormStepProps) {
  const { load, fit, draft, onDraftChange, onSessionEnded, onRefused } = props;
  const [fetched, setFetched] = useState<Fetched>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // The page's callbacks are new on every render; the fetch runs once per attempt.
  const fetchForm = useEffectEvent((signal: AbortSignal) => load(signal));
  const fetchFailed = useEffectEvent((error: unknown) => {
    const outcome = documentOutcome(error);
    if (outcome.kind === 'sessionEnded') onSessionEnded();
    else if (outcome.kind === 'refused' || outcome.kind === 'gone') onRefused(outcome);
    else if (outcome.kind === 'wait') {
      setWaiting(outcome.seconds !== null);
      setFetched(outcome);
    } else setFetched({ kind: 'failed', error });
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchForm(controller.signal).then(
      (form) => setFetched({ kind: 'ready', form }),
      (error: unknown) => {
        if (!controller.signal.aborted) fetchFailed(error);
      },
    );
    return () => controller.abort();
  }, [attempt]);

  // A 429: "try again" waits out Retry-After; the timer ends with the screen.
  const waitSeconds = fetched.kind === 'wait' ? fetched.seconds : null;
  useEffect(() => {
    if (waitSeconds === null) return undefined;
    const timer = setTimeout(() => setWaiting(false), waitSeconds * 1000);
    return () => clearTimeout(timer);
  }, [waitSeconds]);

  const retry = () => {
    setFetched({ kind: 'loading' });
    setAttempt((n) => n + 1);
  };

  if (fetched.kind === 'loading') return <PageLoader />;
  if (fetched.kind === 'failed')
    return <ErrorState {...errorContent(fetched.error)} onRetry={retry} />;
  if (fetched.kind === 'wait') {
    const minutes = fetched.seconds === null ? null : Math.ceil(fetched.seconds / 60);
    return (
      <Box sx={{ display: 'grid', gap: 3 }}>
        <Alert severity="warning" role="alert">
          {minutes === null ? fetched.message : he.sign.document.wait(minutes)}
        </Alert>
        <Box>
          <Button variant="outlined" onClick={retry} disabled={waiting}>
            {he.sign.document.retry}
          </Button>
        </Box>
      </Box>
    );
  }
  return (
    <SignForm
      form={fetched.form}
      draft={draft}
      onDraftChange={onDraftChange}
      fit={fit}
      onSessionEnded={onSessionEnded}
      onRefused={onRefused}
    />
  );
}
