import Button from '@mui/material/Button';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { he } from '../../i18n/he';
import { errorContent } from './error-content';
import { ErrorState } from './ErrorState';

/** The router's error element: a crash in a screen shows a calm message, not a white page. */
export function RouteErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <ErrorState
        variant="notFound"
        title={he.feedback.notFoundTitle}
        message={he.feedback.notFoundText}
      />
    );
  }

  return (
    <ErrorState
      {...errorContent(error)}
      action={
        <Button variant="outlined" onClick={() => window.location.reload()}>
          {he.feedback.retry}
        </Button>
      }
    />
  );
}
