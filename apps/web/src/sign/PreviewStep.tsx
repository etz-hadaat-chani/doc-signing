import { errorMessage, type SignPreviewInput, type SignSubmitInput } from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/dialogs/ConfirmDialog';
import { ErrorState } from '../components/feedback/ErrorState';
import { errorContent } from '../components/feedback/error-content';
import { PageLoader } from '../components/feedback/PageLoader';
import { he } from '../i18n/he';
import { PdfPages } from '../pdf/PdfPages';
import { usePdf } from '../pdf/use-pdf';
import { useWidth } from '../pdf/use-width';
import type { DocumentOutcome } from './document-outcome';
import { ACK_ITEM } from './form/form-draft';
import type { SignedKind } from './form/SignForm';
import { ReadingStatement } from './form/SignatureSection';
import { submitBodyOf } from './form/submit-check';
import { submitOutcome } from './submit-outcome';

const text = he.sign.preview;

/** A send that failed and stays on B3a: "try again", or wait out a 429 first. */
type Failure = { message: string; waitSeconds: number | null };

interface PreviewStepProps {
  /** The watermarked signed PDF from `POST …/preview`; only in this screen's memory. */
  pdf: ArrayBuffer;
  /** The body it was built from: signing sends exactly this, with the reading statement. */
  body: SignPreviewInput;
  acknowledged: boolean;
  onAcknowledged: (acknowledged: boolean) => void;
  /** `POST …/submit` of a link or of the office computer. */
  submit: (body: SignSubmitInput) => Promise<unknown>;
  /** The office computer: the address the copy goes to is shown once more before signing. */
  confirmEmail: boolean;
  onSigned: (kind: SignedKind) => void;
  /** "חזרה לתיקון", or the server refused an answer: B3 with everything kept (and those errors). */
  onBack: (errors?: ReadonlyMap<string, string>) => void;
  /** 401 `SIGN_SESSION_EXPIRED`. */
  onSessionEnded: () => void;
  /** The document can't be signed (any more): the caller shows the B5 screen. */
  onRefused: (outcome: Extract<DocumentOutcome, { kind: 'refused' | 'gone' }>) => void;
}

/**
 * B3a (6.5, FR-SGN-11): the signed document exactly as it will be stored, with "not signed yet"
 * across every page, then the reading statement and "אישור וחתימה" or "חזרה לתיקון". No second
 * scroll rule: she read the whole document on B2, and the statement and the buttons come after
 * the last page anyway. Signing sends the previewed body again (the server builds the PDF anew;
 * these bytes are never sent back). The bytes live only in this screen's state; pdf.js's copy is
 * destroyed when it closes.
 */
export function PreviewStep(props: PreviewStepProps) {
  const { pdf, body, acknowledged, onAcknowledged, submit, confirmEmail } = props;
  const { onSigned, onBack, onSessionEnded, onRefused } = props;
  const pdfState = usePdf(pdf);
  const { ref: areaRef, width } = useWidth();
  const [ackError, setAckError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const sendingRef = useRef(false);
  const ackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // A 429: the button waits out Retry-After; the timer ends with the screen.
  const waitSeconds = failure?.waitSeconds ?? null;
  useEffect(() => {
    if (waitSeconds === null) return undefined;
    const timer = setTimeout(() => setWaiting(false), waitSeconds * 1000);
    return () => clearTimeout(timer);
  }, [waitSeconds]);

  const showAckError = (message: string) => {
    setAckError(message);
    const element = ackRef.current;
    element?.scrollIntoView?.({ block: 'center' });
    element?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
  };

  const send = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setFailure(null);
    try {
      await submit(submitBodyOf(body));
      // The screen ends here; the button stays off until it does.
      onSigned('signed');
      return;
    } catch (error) {
      const outcome = submitOutcome(error);
      if (outcome.kind === 'fields') {
        const ack = outcome.errors.get(ACK_ITEM);
        if (ack !== undefined && outcome.errors.size === 1) showAckError(ack);
        else onBack(outcome.errors);
      } else if (outcome.kind === 'sessionEnded') onSessionEnded();
      else if (outcome.kind === 'alreadySigned') onSigned('alreadySigned');
      else if (outcome.kind === 'refused' || outcome.kind === 'gone') onRefused(outcome);
      else if (outcome.kind === 'wait') {
        const minutes = outcome.seconds === null ? null : Math.ceil(outcome.seconds / 60);
        setWaiting(outcome.seconds !== null);
        setFailure({
          message: minutes === null ? outcome.message : he.sign.document.wait(minutes),
          waitSeconds: outcome.seconds,
        });
      } else setFailure({ message: outcome.message, waitSeconds: null });
    }
    sendingRef.current = false;
    setSending(false);
  };

  /** "אישור וחתימה": the statement first; on the office computer the copy's address once more. */
  const press = () => {
    if (sendingRef.current || waiting) return;
    if (!acknowledged) {
      showAckError(errorMessage('SIGN_ACK_REQUIRED'));
      return;
    }
    if (confirmEmail && body.emailChoice === 'email') {
      setConfirming(true);
      return;
    }
    void send();
  };

  if (pdfState.status === 'error') {
    // pdf.js could not read it: back to the form, where she can ask for it again.
    return <ErrorState {...errorContent(null)} onRetry={() => onBack()} />;
  }

  const backButton = (
    <Button variant="outlined" onClick={() => onBack()} disabled={sending}>
      {text.back}
    </Button>
  );

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box>
        <Typography variant="h1" sx={{ mb: 2 }}>
          {text.title}
        </Typography>
        <Typography sx={{ mb: 2 }}>{text.intro}</Typography>
        {backButton}
      </Box>
      <Box ref={areaRef} dir="ltr" role="region" aria-label={text.label} sx={{ width: '100%' }}>
        {pdfState.status === 'ready' ? (
          <PdfPages pdf={pdfState.pdf} width={width} pageLabel={he.sign.document.pageLabel} />
        ) : (
          <PageLoader />
        )}
      </Box>
      <Box ref={ackRef}>
        <ReadingStatement
          acknowledged={acknowledged}
          error={ackError}
          onChange={(checked) => {
            setAckError(null);
            onAcknowledged(checked);
          }}
        />
      </Box>
      {failure && (
        <Alert
          severity={failure.waitSeconds === null ? 'error' : 'warning'}
          role="alert"
          action={
            failure.waitSeconds === null && (
              <Button color="inherit" onClick={press} disabled={sending}>
                {text.retry}
              </Button>
            )
          }
        >
          {failure.message}
        </Alert>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        <Button variant="contained" onClick={press} disabled={sending || waiting}>
          {sending ? text.sending : text.confirm}
        </Button>
        {backButton}
      </Box>
      <ConfirmDialog
        open={confirming}
        title={text.confirmTitle}
        text={
          <>
            {text.confirmText}
            {/* Its own line, left to right: a long address never hides the line before it. */}
            <Box
              component="bdi"
              dir="ltr"
              sx={{ display: 'block', my: 1, fontWeight: 600, overflowWrap: 'anywhere' }}
            >
              {(body.email ?? '').trim().toLowerCase()}
            </Box>
            <Box component="span" sx={{ display: 'block' }}>
              {text.confirmCheck}
            </Box>
          </>
        }
        confirmLabel={text.confirmSign}
        cancelLabel={text.back}
        onConfirm={() => {
          setConfirming(false);
          void send();
        }}
        onClose={() => setConfirming(false)}
      />
    </Box>
  );
}
