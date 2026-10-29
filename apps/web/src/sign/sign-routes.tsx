import { KIOSK_PAGE_PATH } from '@doc-signing/shared';
import type { RouteObject } from 'react-router';
import { RouteErrorBoundary } from '../components/feedback/RouteErrorBoundary';
import { KioskCodePage } from './KioskCodePage';
import { SignPlaceholderPage } from './SignPlaceholderPage';

/** Phase 6 replaces the placeholder with B1–B5 (and the kiosk's steps after its code page). */
export const signRoutes: RouteObject[] = [
  { path: '/sign/*', element: <SignPlaceholderPage />, errorElement: <RouteErrorBoundary /> },
  { path: KIOSK_PAGE_PATH, element: <KioskCodePage />, errorElement: <RouteErrorBoundary /> },
];
