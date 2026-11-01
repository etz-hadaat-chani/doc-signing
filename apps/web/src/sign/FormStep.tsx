import type { SignFormResult, SignPreviewInput, SignSubmitInput } from '@doc-signing/shared';
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
import { SignForm, type SignedKind } from './form/SignForm';
import type { FitCall } from './form/use-fit-check';
import { PreviewStep } from './PreviewStep';

type Fetched =
  | { kind: 'loading' }
  | { kind: 'ready'; form: SignFormResult }
  | { kind: 'wait'; seconds: number | null; message: string }
  | { kind: 'failed'; error: unknown };

/** B3 (with the server's refusals handed back from B3a, if any), or B3a with its PDF. */
type Stage =
  | { kind: 'form'; errors?: ReadonlyMap<string, string> }
  | { kind: 'preview'; pdf: ArrayBuffer; body: SignPreviewInput };

interface FormStepProps {
  /** `GET …/form` of a link or of the office computer, with the session cookie only. */
  load: (signal: AbortSignal) => Promise<SignFormResult>;
  /** `POST …/fit` of the same channel. */
  fit: FitCall;
  /** `POST …/preview` of the same channel: the signed PDF, watermarked (B3a). */
  preview: (body: SignPreviewInput) => Promise<ArrayBuffer>;
  /** `POST …/submit` of the same channel. */
  submit: (body: SignSubmitInput) => Promise<unknown>;
  /** The office computer: the copy's address once more before signing (on B3a). */
  confirmEmail?: boolean;
  /** B3a opened or closed: the page uses the wide card for the pages, as on B2. */
  onPreviewChange?: (open: boolean) => void;
  /** Signed (or found already signed): the caller shows B4 and drops everything. */
  onSigned: (kind: SignedKind) => void;
  /** Her answers, kept by the page (so a new ID check keeps them). */
  draft: FormDraft;
  onDraftChange: Dispatch<SetStateAction<FormDraft>>;
  /** 401 `SIGN_SESSION_EXPIRED`. */
  onSessionEnded: () => void;
  /** The document can't be signed (any more): the caller shows the B5 screen. */
  onRefused: (outcome: Extract<DocumentOutcome, { kind: 'refused' | 'gone' }>) => void;
}

/**
 * B3 (FR-SGN-4, FR-SGN-5) and B3a (6.5): reads the form once (plain state, no data cache) and
 * shows it from the top (B2 left the page scrolled to its end). The same answers as B2: a session
 * that ended, a refusal (B5), a 429 wait, or "try again". The form's button opens B3a with the
 * previewed PDF; "חזרה לתיקון" comes back here (the form is not fetched again, the draft is kept).
 */
export function FormStep(props: FormStepProps) {
  const { load, fit, preview, submit, confirmEmail = false, onSigned, onPreviewChange } = props;
  const { draft, onDraftChange, onSessionEnded, onRefused } = props;
  const [fetched, setFetched] = useState<Fetched>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'form' });

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

  const toStage = (next: Stage) => {
    setStage(next);
    onPreviewChange?.(next.kind === 'preview');
    // B3 opens at its top again (B3a scrolls itself to its top).
    if (next.kind === 'form') window.scrollTo(0, 0);
  };

  // Leaving B3 / B3a (signed, refused, session ended): the page's card goes back to its width.
  const previewClosed = useEffectEvent(() => onPreviewChange?.(false));
  useEffect(() => () => previewClosed(), []);

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
  if (stage.kind === 'preview') {
    return (
      <PreviewStep
        pdf={stage.pdf}
        body={stage.body}
        acknowledged={draft.acknowledged}
        onAcknowledged={(acknowledged) =>
          onDraftChange((current) => ({ ...current, acknowledged }))
        }
        submit={submit}
        confirmEmail={confirmEmail}
        onSigned={onSigned}
        onBack={(errors) => toStage({ kind: 'form', errors })}
        onSessionEnded={onSessionEnded}
        onRefused={onRefused}
      />
    );
  }
  return (
    <SignForm
      form={fetched.form}
      draft={draft}
      onDraftChange={onDraftChange}
      fit={fit}
      preview={preview}
      onPreviewed={(pdf, body) => {
        // The statement is ticked for the document she is about to see, every time anew.
        onDraftChange((current) => ({ ...current, acknowledged: false }));
        toStage({ kind: 'preview', pdf, body });
      }}
      initialErrors={stage.errors}
      onSigned={onSigned}
      onSessionEnded={onSessionEnded}
      onRefused={onRefused}
    />
  );
}
