import { loginSchema } from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { isApiRequestError } from '../../api/api-error';
import { Wordmark } from '../../components/brand/Wordmark';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';
import { type LoginRedirectState, safeRedirectPath } from './safe-redirect';
import { useLogin } from './session';

interface FieldErrors {
  email?: string;
  password?: string;
}

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (email.trim() === '') errors.email = he.login.emailRequired;
  else if (!loginSchema.shape.email.safeParse(email).success) errors.email = he.login.emailInvalid;
  if (password === '') errors.password = he.login.passwordRequired;
  return errors;
}

/** The API's Hebrew text (the same for a wrong email or a wrong password), plus when to retry. */
function submitErrorText(error: unknown): string[] {
  if (!isApiRequestError(error)) return [he.feedback.unexpectedText];
  const seconds = error.retryAfterSeconds;
  return seconds
    ? [error.message, he.login.retryInMinutes(Math.ceil(seconds / 60))]
    : [error.message];
}

/** A1. Calm and centered: wordmark, system name, two fields, one button. */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const loginMutation = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = validate(email, password);
    setFieldErrors(errors);
    if (errors.email ?? errors.password) return;

    try {
      await loginMutation.mutateAsync(loginSchema.parse({ email, password }));
    } catch {
      setPassword('');
      return;
    }
    const state = location.state as LoginRedirectState | null;
    await navigate(safeRedirectPath(state?.from), { replace: true });
  };

  return (
    <Box
      component="main"
      sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', px: 2, py: 6 }}
    >
      <Paper
        variant="outlined"
        sx={{
          width: '100%',
          maxWidth: 400,
          p: { xs: 3, sm: 5 },
          borderTop: `${tokens.layout.edgeWidth}px solid ${tokens.color.accent}`,
        }}
      >
        <Wordmark fontSize={tokens.font.size.section} />
        {/* The wordmark already carries the accent rule; no title bar here. */}
        <Typography
          variant="h1"
          sx={{ mt: 1.5, mb: 4, borderInlineStart: 'none', paddingInlineStart: 0 }}
        >
          {he.app.systemName}
        </Typography>

        {/* method="post": even without JavaScript the password never goes into the URL. */}
        <Box
          component="form"
          method="post"
          noValidate
          aria-label={he.login.title}
          onSubmit={(event: FormEvent<HTMLFormElement>) => void handleSubmit(event)}
          sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}
        >
          {loginMutation.isError && (
            <Alert severity="error">
              {submitErrorText(loginMutation.error).map((line) => (
                <div key={line}>{line}</div>
              ))}
            </Alert>
          )}
          <TextField
            label={he.login.email}
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setFieldErrors((errors) => ({ ...errors, email: undefined }));
            }}
            error={Boolean(fieldErrors.email)}
            helperText={fieldErrors.email}
            fullWidth
            autoFocus
            slotProps={{ htmlInput: { dir: 'ltr', maxLength: 255 } }}
          />
          <TextField
            label={he.login.password}
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setFieldErrors((errors) => ({ ...errors, password: undefined }));
            }}
            error={Boolean(fieldErrors.password)}
            helperText={fieldErrors.password}
            fullWidth
            slotProps={{ htmlInput: { dir: 'ltr', maxLength: 1024 } }}
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? he.login.submitting : he.login.submit}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
