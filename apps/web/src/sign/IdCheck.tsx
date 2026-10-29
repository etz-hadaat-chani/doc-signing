import { isValidIdNumber } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { he } from '../i18n/he';
import { verifyOutcome, type VerifyOutcome } from './id-check-outcome';

const text = he.sign.idCheck;

/** An Israeli ID number has at most 9 digits (fewer when it starts with zeros). */
const ID_MAX_LENGTH = 9;

interface IdCheckProps {
  /** `POST …/verify` of a link or of the office computer, the number only in its body. */
  verify: (idNumber: string) => Promise<unknown>;
  onVerified: () => void;
  /** The link or code can't be used (any more): the caller shows the B5 screen. */
  onRefused: (outcome: Exclude<VerifyOutcome, { kind: 'retry' }>) => void;
  /** Above the field, e.g. "the code was accepted" on the office computer. */
  notice?: ReactNode;
}

/**
 * B1 (FR-SGN-2): a short welcome, one ID number field and "Continue". The number lives only in
 * the field: it is emptied before the request is awaited and never kept anywhere else (no ref,
 * cache or storage). The form is `method="post"` without an action and the field has no name,
 * so even a submit without the script sends nothing in the address. After a refusal the field
 * is empty, focused, and the line under it is announced.
 */
export function IdCheck({ verify, onVerified, onRefused, notice }: IdCheckProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<number | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const titleId = useId();

  // A 429: the button waits out Retry-After; the timer ends with the page.
  useEffect(() => {
    if (waiting === null) return;
    const timer = setTimeout(() => setWaiting(null), waiting * 1000);
    return () => clearTimeout(timer);
  }, [waiting]);

  const showError = (message: string) => {
    setError(message);
    field.current?.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || waiting !== null) return;
    if (value === '') return showError(text.required);
    if (!isValidIdNumber(value)) return showError(text.invalid);
    const idNumber = value;
    setValue('');
    setError(null);
    setBusy(true);
    try {
      await verify(idNumber);
      onVerified();
    } catch (failure) {
      const outcome = verifyOutcome(failure);
      if (outcome.kind !== 'retry') {
        onRefused(outcome);
        return;
      }
      if (outcome.waitSeconds !== undefined) setWaiting(outcome.waitSeconds);
      showError(outcome.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      component="form"
      method="post"
      noValidate
      aria-labelledby={titleId}
      onSubmit={(event) => void submit(event)}
      sx={{ display: 'grid', gap: 3 }}
    >
      <Typography variant="h1" id={titleId}>
        {text.title}
      </Typography>
      {notice}
      <Typography>{text.intro}</Typography>
      <TextField
        label={text.field}
        value={value}
        onChange={(event) => {
          setValue(event.target.value.replace(/\D/g, '').slice(0, ID_MAX_LENGTH));
          setError(null);
        }}
        error={error !== null}
        helperText={error ?? text.hint}
        inputRef={field}
        autoComplete="off"
        autoFocus
        slotProps={{
          htmlInput: {
            inputMode: 'numeric',
            dir: 'ltr',
            maxLength: ID_MAX_LENGTH,
            spellCheck: false,
          },
          formHelperText: error === null ? {} : { role: 'alert' },
        }}
      />
      <Button type="submit" variant="contained" disabled={busy || waiting !== null}>
        {text.submit}
      </Button>
    </Box>
  );
}
