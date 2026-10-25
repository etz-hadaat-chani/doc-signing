import { Navigate, Outlet, useLocation } from 'react-router';
import { errorContent } from '../../components/feedback/error-content';
import { ErrorState } from '../../components/feedback/ErrorState';
import { PageLoader } from '../../components/feedback/PageLoader';
import type { LoginRedirectState } from './safe-redirect';
import { useCurrentUser } from './session';

/** The management area needs a signed-in user; otherwise to /login, remembering the page. */
export function RequireAuth() {
  const location = useLocation();
  const { data: user, isPending, isError, error, refetch } = useCurrentUser();

  if (isPending) return <PageLoader />;
  if (isError) return <ErrorState {...errorContent(error)} onRetry={() => void refetch()} />;
  if (!user) {
    const state: LoginRedirectState = {
      from: `${location.pathname}${location.search}${location.hash}`,
    };
    return <Navigate to="/login" replace state={state} />;
  }
  return <Outlet />;
}
