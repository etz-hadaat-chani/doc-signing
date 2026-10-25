import Button from '@mui/material/Button';
import { Link as RouterLink } from 'react-router';
import { ErrorState } from '../../components/feedback/ErrorState';
import { he } from '../../i18n/he';

export function NotFoundPage() {
  return (
    <ErrorState
      variant="notFound"
      title={he.feedback.notFoundTitle}
      message={he.feedback.notFoundText}
      action={
        <Button variant="outlined" component={RouterLink} to="/">
          {he.feedback.backToDashboard}
        </Button>
      }
    />
  );
}
