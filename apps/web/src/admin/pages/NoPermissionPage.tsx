import Button from '@mui/material/Button';
import { Link as RouterLink } from 'react-router';
import { ErrorState } from '../../components/feedback/ErrorState';
import { he } from '../../i18n/he';

export function NoPermissionPage() {
  return (
    <ErrorState
      variant="forbidden"
      title={he.feedback.noPermissionTitle}
      message={he.feedback.noPermissionText}
      action={
        <Button variant="outlined" component={RouterLink} to="/">
          {he.feedback.backToDashboard}
        </Button>
      }
    />
  );
}
