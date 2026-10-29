import {
  isKioskShortCodeShape,
  KIOSK_SHORT_CODE_LENGTH,
  normalizeKioskShortCode,
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
import { tokens } from '../theme/tokens';
import { enterKioskCode, kioskState } from './kiosk.api';

const text = he.sign.kiosk;

/** Room for the hyphen and spaces a code may be typed with. */
const FIELD_MAX_LENGTH = KIOSK_SHORT_CODE_LENGTH + 4;

/** The Hebrew text of a failed call: a wrong code, a staff user signed in, too many tries. */
function failureText(error: unknown): string {
  if (!isApiRequestError(error)) return he.feedback.crashText;
  if (error.status === 404) return text.wrong;
  return error.message;
}

function StateResult({ result }: { result: SignLinkStateResult }) {
  if (result.state === 'valid') {
    return (
      <Alert severity="success">
        <Typography sx={{ fontWeight: 700 }}>{text.accepted}</Typography>
        <Typography>{text.nextStep}</Typography>
      </Alert>
    );
  }
  return (
    <Alert severity="warning">
      <Typography sx={{ fontWeight: 700 }}>{text.states[result.state]}</Typography>
      <Typography>
        <bdi>{text.hrContact(result.hrContact.name)}</bdi>
        {[result.hrContact.phone, result.hrContact.email]
          .filter((value) => value !== null)
          .map((value) => (
            <bdi key={value} dir="ltr">
              {' '}
              {value}
            </bdi>
          ))}
      </Typography>
    </Alert>
  );
}

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

  return (
    <Box
      component="main"
      sx={{ maxWidth: tokens.layout.contentMaxWidth, mx: 'auto', p: { xs: 2, sm: 4 } }}
    >
      <Typography variant="h1" sx={{ mb: 2 }}>
        {text.title}
      </Typography>
      {result ? (
        <Box sx={{ display: 'grid', gap: 2, justifyItems: 'start' }}>
          <StateResult result={result} />
          <Button variant="outlined" onClick={again}>
            {text.again}
          </Button>
        </Box>
      ) : (
        <Box
          component="form"
          noValidate
          onSubmit={(event) => void submit(event)}
          sx={{ display: 'grid', gap: 2, maxWidth: 360 }}
        >
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
                style: { fontFamily: 'monospace', fontSize: '1.5rem', letterSpacing: '0.1em' },
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
    </Box>
  );
}
