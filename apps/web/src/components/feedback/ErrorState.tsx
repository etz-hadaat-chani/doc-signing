import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import WifiOffOutlined from '@mui/icons-material/WifiOffOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type SvgIcon from '@mui/material/SvgIcon';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { he } from '../../i18n/he';
import type { ErrorContent, ErrorVariant } from './error-content';

const ICONS: Record<ErrorVariant, typeof SvgIcon> = {
  forbidden: LockOutlined,
  notFound: SearchOffOutlined,
  server: ErrorOutlineOutlined,
  network: WifiOffOutlined,
  crash: ErrorOutlineOutlined,
};

interface ErrorStateProps extends ErrorContent {
  /** Shows a "try again" button. */
  onRetry?: () => void;
  /** Another button, e.g. back to the dashboard. */
  action?: ReactNode;
  /** The title's tag: `h1` for a whole page, `h2` / `h3` inside a page (a table or section that failed). */
  headingComponent?: 'h1' | 'h2' | 'h3';
}

/** The one error look of the app: no permission, not found, server error, no connection. */
export function ErrorState({
  variant,
  title,
  message,
  referenceId,
  onRetry,
  action,
  headingComponent = 'h1',
}: ErrorStateProps) {
  const Icon = ICONS[variant];
  return (
    <Box
      role="alert"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 2,
        py: 10,
        px: 2,
        maxWidth: 520,
        mx: 'auto',
      }}
    >
      <Icon sx={{ fontSize: 40, color: 'text.secondary' }} aria-hidden />
      <Typography variant="h2" component={headingComponent}>
        {title}
      </Typography>
      <Typography color="text.secondary">{message}</Typography>
      {referenceId && (
        <Typography variant="body2" color="text.secondary">
          {he.feedback.referenceId(referenceId)}
        </Typography>
      )}
      {(onRetry ?? action) && (
        <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
          {onRetry && (
            <Button variant="outlined" onClick={onRetry}>
              {he.feedback.retry}
            </Button>
          )}
          {action}
        </Box>
      )}
    </Box>
  );
}
