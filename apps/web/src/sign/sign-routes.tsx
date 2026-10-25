import type { RouteObject } from 'react-router';
import { RouteErrorBoundary } from '../components/feedback/RouteErrorBoundary';
import { SignPlaceholderPage } from './SignPlaceholderPage';

/** Phase 6 replaces the placeholder with B1–B5. */
export const signRoutes: RouteObject[] = [
  { path: '/sign/*', element: <SignPlaceholderPage />, errorElement: <RouteErrorBoundary /> },
];
