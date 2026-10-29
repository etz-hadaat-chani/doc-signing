import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { ErrorState } from '../components/feedback/ErrorState';
import { errorContent } from '../components/feedback/error-content';
import { PageLoader } from '../components/feedback/PageLoader';
import { he } from '../i18n/he';
import { PdfPages } from '../pdf/PdfPages';
import { usePdf } from '../pdf/use-pdf';
import { useWidth } from '../pdf/use-width';
import { documentOutcome, type DocumentOutcome } from './document-outcome';

const text = he.sign.document;

/** Used until the bar is measured (a 56 px button, its line and padding). */
const BAR_FALLBACK_HEIGHT = 120;

const canObserve = () => typeof IntersectionObserver !== 'undefined';

type Fetched =
  | { kind: 'loading' }
  | { kind: 'ready'; bytes: ArrayBuffer }
  | { kind: 'wait'; seconds: number | null; message: string }
  | { kind: 'failed'; error: unknown };

interface DocumentStepProps {
  /** `GET …/document` of a link or of the office computer, with the session cookie only. */
  load: (signal: AbortSignal) => Promise<ArrayBuffer>;
  /** She reached the end and pressed the button. */
  onContinue: () => void;
  /** 401 `SIGN_SESSION_EXPIRED`. */
  onSessionEnded: () => void;
  /** The document can't be signed (any more): the caller shows the B5 screen. */
  onRefused: (outcome: Extract<DocumentOutcome, { kind: 'refused' | 'gone' }>) => void;
}

/**
 * B2 (FR-SGN-3): her personalized PDF, every page drawn by pdf.js and fitted to the card, and
 * "continue" only after she scrolled to the end. The page itself scrolls (wheel, keyboard and
 * scroll bar as usual, nothing forced); an observer on a mark after the last page turns the
 * button on once. The bytes live only in this screen's state (no data cache, no storage, no
 * blob URL); pdf.js's copy is destroyed when the screen closes.
 */
export function DocumentStep({ load, onContinue, onSessionEnded, onRefused }: DocumentStepProps) {
  const [fetched, setFetched] = useState<Fetched>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [barHeight, setBarHeight] = useState(BAR_FALLBACK_HEIGHT);
  const { ref: areaRef, width } = useWidth();
  const end = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const pdfState = usePdf(fetched.kind === 'ready' ? fetched.bytes : undefined);
  const ready = pdfState.status === 'ready';

  // The page's callbacks are new on every render; the fetch runs once per attempt.
  const fetchDocument = useEffectEvent((signal: AbortSignal) => load(signal));
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
    fetchDocument(controller.signal).then(
      (bytes) => setFetched({ kind: 'ready', bytes }),
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

  // The bar's height, for the space under the last page (the bar never hides its last lines).
  useEffect(() => {
    const element = bar.current;
    if (!ready || !element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (element.offsetHeight > 0) setBarHeight(element.offsetHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready]);

  // The end mark is watched once the pages have their size; a short document turns it on at once.
  useEffect(() => {
    const element = end.current;
    if (!ready || reachedEnd || !element || !canObserve()) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setReachedEnd(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready, reachedEnd]);

  // A browser without the observer can't tell: the button is on.
  const atEnd = reachedEnd || !canObserve();

  const retry = () => {
    setFetched({ kind: 'loading' });
    setReachedEnd(false);
    setAttempt((n) => n + 1);
  };

  if (fetched.kind === 'failed' || pdfState.status === 'error') {
    // pdf.js could not read it: the general "something went wrong".
    const error = fetched.kind === 'failed' ? fetched.error : null;
    return <ErrorState {...errorContent(error)} onRetry={retry} />;
  }
  if (fetched.kind === 'wait') {
    const minutes = fetched.seconds === null ? null : Math.ceil(fetched.seconds / 60);
    return (
      <Box sx={{ display: 'grid', gap: 3 }}>
        <Alert severity="warning" role="alert">
          {minutes === null ? fetched.message : text.wait(minutes)}
        </Alert>
        <Box>
          <Button variant="outlined" onClick={retry} disabled={waiting}>
            {text.retry}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h1" sx={{ mb: 2 }}>
        {text.title}
      </Typography>
      <Typography sx={{ mb: 3 }}>{text.fillLater}</Typography>
      <Box ref={areaRef} dir="ltr" role="region" aria-label={text.label} sx={{ width: '100%' }}>
        {ready ? (
          <PdfPages pdf={pdfState.pdf} width={width} pageLabel={text.pageLabel} />
        ) : (
          <PageLoader />
        )}
      </Box>
      {ready && (
        <>
          <Box aria-hidden sx={{ height: barHeight }} />
          <Box ref={end} data-testid="document-end" sx={{ height: 1 }} />
          <Box
            ref={bar}
            sx={{
              position: 'sticky',
              bottom: 0,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 2,
              py: 1.5,
              bgcolor: 'background.paper',
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            <Button
              variant="contained"
              size="large"
              disabled={!atEnd}
              onClick={onContinue}
              aria-describedby={atEnd ? undefined : hintId}
            >
              {text.continue}
            </Button>
            {!atEnd && (
              <Typography id={hintId} variant="body2" color="text.secondary">
                {text.scrollHint}
              </Typography>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
