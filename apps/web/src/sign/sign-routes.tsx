import { KIOSK_PAGE_PATH } from '@doc-signing/shared';
import type { RouteObject } from 'react-router';
import { RouteErrorBoundary } from '../components/feedback/RouteErrorBoundary';
import { KioskCodePage } from './KioskCodePage';
import { SignLinkPage, SignNotFoundPage } from './SignLinkPage';

/** The employee area: a link (B1–B5) and the office computer (its code page, then B1–B5). */
export const signRoutes: RouteObject[] = [
  { path: '/sign/:token', element: <SignLinkPage />, errorElement: <RouteErrorBoundary /> },
  { path: '/sign/*', element: <SignNotFoundPage />, errorElement: <RouteErrorBoundary /> },
  { path: KIOSK_PAGE_PATH, element: <KioskCodePage />, errorElement: <RouteErrorBoundary /> },
];
