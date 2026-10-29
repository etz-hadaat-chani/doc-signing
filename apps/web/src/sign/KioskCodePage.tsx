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
import { enterKioskCode, kioskState } from './kiosk.api';
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
 * address, storage or the data cache) → `POST /api/kiosk/state`. Part B ends there: "valid" shows
 * "the code was accepted"; the ID check and the signing screens are 6.1–6.4 (B1–B5). A staff
 * user signed in on this computer gets the API's 409 text.
 */
export function KioskCodePage() {
  const [typed, setTyped] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SignLinkStateResult | null>(null);
  // The long code: for the next steps (6.x) only, never shown or stored.
  const kioskCode = useRef<string | null>(null);

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
    setResult(null);
    setFailure(null);
  };

  const againButton = (
    <Button variant="outlined" onClick={again}>
      {text.again}
    </Button>
  );

  return (
    <SignLayout>
      {result && result.state !== 'valid' ? (
        <MessagePage
          kind={MESSAGE_OF[result.state]}
          hrContact={result.hrContact}
          action={againButton}
        />
      ) : result ? (
        <Box sx={{ display: 'grid', gap: 3, justifyItems: 'start' }}>
          <Typography variant="h1">{text.title}</Typography>
          <Alert severity="success" sx={{ width: '100%' }}>
            {text.accepted}
          </Alert>
          <Typography>{he.sign.idCheckNext}</Typography>
          {againButton}
        </Box>
      ) : (
        <Box
          component="form"
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
