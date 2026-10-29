import {
  isKioskShortCodeShape,
  KIOSK_SHORT_CODE_LENGTH,
  normalizeKioskShortCode,
  type SignLinkState,
  type SignLinkStateResult,
} from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type FormEvent, useRef, useState } from 'react';
import { isApiRequestError } from '../api/api-error';
import { he } from '../i18n/he';
import { DocumentStep } from './DocumentStep';
import { EMPTY_DRAFT, type FormDraft } from './form/form-draft';
import { FormStep } from './FormStep';
import type { VerifyOutcome } from './id-check-outcome';
import { IdCheck } from './IdCheck';
import {
  enterKioskCode,
  kioskDocument,
  kioskFit,
  kioskForm,
  kioskState,
  verifyKiosk,
} from './kiosk.api';
import { MessagePage, type SignMessageKind } from './MessagePage';
import { SignLayout } from './SignLayout';

const text = he.sign.kiosk;

/** Room for the hyphen and spaces a code may be typed with. */
const FIELD_MAX_LENGTH = KIOSK_SHORT_CODE_LENGTH + 4;

/** The Hebrew text of a failed call: a wrong code, a staff user signed in, too many tries. */
function failureText(error: unknown): string {
  if (!isApiRequestError(error)) return he.feedback.crashText;
  if (error.status === 404) return text.wrong;
  return error.message;
}

/** The B5 screen of a state that can't be signed here (a closed round reads "expired"). */
const MESSAGE_OF: Record<Exclude<SignLinkState, 'valid'>, SignMessageKind> = {
  signed: 'signed',
  cancelled: 'cancelled',
  expired: 'kioskExpired',
  locked: 'kioskLocked',
};

/**
 * `/kiosk` on the office computer (5.7, FR-MAN-4, decision D1): the short code the manager
 * read off A10 → `POST /api/kiosk/code` → the long kiosk code, kept only in a ref (never in the
 * address, storage or the data cache) → `POST /api/kiosk/state` → B5 for a state that can't be
 * signed, or B1 (6.2): the same ID check as a link through `POST /api/kiosk/verify { code,
 * idNumber }`. A kiosk session with its own 5 attempts (D2) answers the same 401 / 423; a 423
 * or an ended code shows "ask the manager". A staff user signed in on this computer gets the
 * API's 409 text. The long code is dropped once the ID is correct (the `kiosk_sid` cookie
 * carries the session from there): B2 (6.3) reads the document with the cookie only. A session
 * that ended there or on B3 can't ask the ID again (the code is used up): "ask the manager";
 * her B3 answers are dropped with it.
 */
export function KioskCodePage() {
  const [typed, setTyped] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SignLinkStateResult | null>(null);
  const [refused, setRefused] = useState<SignMessageKind | null>(null);
  // After the correct ID number: the document (B2), then the form.
  const [step, setStep] = useState<'document' | 'form' | null>(null);
  // The long code: for the ID check only, never shown or stored.
  const kioskCode = useRef<string | null>(null);
  // Her B3 answers. A session that ends here can't be resumed (the code is used up): dropped.
  const [draft, setDraft] = useState<FormDraft>(EMPTY_DRAFT);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const code = normalizeKioskShortCode(typed);
    if (code === '') {
      setFieldError(text.required);
      return;
    }
    if (!isKioskShortCodeShape(code)) {
      setFieldError(text.shape);
      return;
    }
    setFieldError(null);
    setFailure(null);
    setBusy(true);
    try {
      const entered = await enterKioskCode(code);
      kioskCode.current = entered.code;
      setTyped('');
      setResult(await kioskState(entered.code));
    } catch (error) {
      setFailure(failureText(error));
    } finally {
      setBusy(false);
    }
  };

  const again = () => {
    kioskCode.current = null;
    setDraft(EMPTY_DRAFT);
    setStep(null);
    setResult(null);
    setRefused(null);
    setFailure(null);
  };

  const againButton = (
    <Button variant="outlined" onClick={again}>
      {text.again}
    </Button>
  );

  const verify = (idNumber: string) => verifyKiosk(kioskCode.current ?? '', idNumber);

  const onVerified = () => {
    kioskCode.current = null;
    setStep('document');
  };

  const onRefused = (outcome: Exclude<VerifyOutcome, { kind: 'retry' }>) => {
    kioskCode.current = null;
    setRefused(outcome.kind === 'gone' ? 'kioskCodeGone' : MESSAGE_OF[outcome.state]);
    setDraft(EMPTY_DRAFT);
    setStep(null);
  };

  const message = refused ?? (result && result.state !== 'valid' ? MESSAGE_OF[result.state] : null);

  return (
    <SignLayout wide={step === 'document'}>
      {result && message ? (
        <MessagePage kind={message} hrContact={result.hrContact} action={againButton} />
      ) : step === 'document' ? (
        <DocumentStep
          load={kioskDocument}
          onContinue={() => setStep('form')}
          onSessionEnded={() => onRefused({ kind: 'gone' })}
          onRefused={onRefused}
        />
      ) : step === 'form' ? (
        <FormStep
          load={kioskForm}
          fit={kioskFit}
          draft={draft}
          onDraftChange={setDraft}
          onSessionEnded={() => onRefused({ kind: 'gone' })}
          onRefused={onRefused}
        />
      ) : result ? (
        <Box sx={{ display: 'grid', gap: 3 }}>
          <IdCheck
            verify={verify}
            onVerified={onVerified}
            onRefused={onRefused}
            notice={<Alert severity="success">{text.accepted}</Alert>}
          />
          <Box>{againButton}</Box>
        </Box>
      ) : (
        <Box
          component="form"
          method="post"
          noValidate
          onSubmit={(event) => void submit(event)}
          sx={{ display: 'grid', gap: 3 }}
        >
          <Typography variant="h1">{text.title}</Typography>
          <Typography>{text.intro}</Typography>
          <TextField
            label={text.field}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value.toUpperCase().slice(0, FIELD_MAX_LENGTH));
              setFieldError(null);
            }}
            error={fieldError !== null}
            helperText={fieldError ?? ' '}
            autoComplete="off"
            autoFocus
            slotProps={{
              htmlInput: {
                dir: 'ltr',
                spellCheck: false,
                autoCapitalize: 'characters',
                maxLength: FIELD_MAX_LENGTH,
                style: { fontFamily: 'monospace', fontSize: '1.75rem', letterSpacing: '0.1em' },
              },
            }}
          />
          {failure && (
            <Alert severity="error" role="alert">
              {failure}
            </Alert>
          )}
          <Button type="submit" variant="contained" disabled={busy}>
            {text.submit}
          </Button>
        </Box>
      )}
    </SignLayout>
  );
}
