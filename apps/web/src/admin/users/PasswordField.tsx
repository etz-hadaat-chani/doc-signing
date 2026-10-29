import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@doc-signing/shared';
import TextField from '@mui/material/TextField';
import { he } from '../../i18n/he';

/**
 * A new staff password: masked, `new-password` (the browser offers to generate or save it, never
 * fills in the manager's own), no length cap in the box (the check names the rule).
 */
export function PasswordField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      id={id}
      type="password"
      autoComplete="new-password"
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required
      error={error !== undefined}
      helperText={error ?? he.users.fields.passwordHint(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)}
      slotProps={{ htmlInput: { dir: 'ltr', spellCheck: false } }}
      fullWidth
    />
  );
}
