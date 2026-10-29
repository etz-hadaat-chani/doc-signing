import { type ComponentType, lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router';
import { PageLoader } from '../components/feedback/PageLoader';
import { RouteErrorBoundary } from '../components/feedback/RouteErrorBoundary';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { RequireRole } from './auth/RequireRole';
import { AdminLayout } from './layout/AdminLayout';
import { ADMIN_PAGES, type AdminPage } from './navigation';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { StaffRoot } from './StaffRoot';

/**
 * The real screen of a page, by its path; the others still show PlaceholderPage. Loaded on first
 * visit, after the role check (another role never downloads it). The demo exists only in
 * `pnpm dev`: the production build drops this branch and never builds its chunk.
 */
const PAGE_COMPONENTS: Partial<Record<string, ComponentType>> = {
  '/': lazy(() =>
    import('./dashboard/DashboardPage').then((module) => ({ default: module.DashboardPage })),
  ),
  '/rounds': lazy(() =>
    import('./rounds/RoundsPage').then((module) => ({ default: module.RoundsPage })),
  ),
  '/rounds/:roundId': lazy(() =>
    import('./rounds/RoundDetailsPage').then((module) => ({ default: module.RoundDetailsPage })),
  ),
  '/rounds/new': lazy(() =>
    import('./rounds/new/NewRoundPage').then((module) => ({ default: module.NewRoundPage })),
  ),
  '/employees': lazy(() =>
    import('./employees/EmployeesPage').then((module) => ({ default: module.EmployeesPage })),
  ),
  '/employees/import': lazy(() =>
    import('./employees/import/EmployeeImportPage').then((module) => ({
      default: module.EmployeeImportPage,
    })),
  ),
  '/employees/new': lazy(() =>
    import('./employees/EmployeeFormPage').then((module) => ({
      default: module.EmployeeFormPage,
    })),
  ),
  '/employees/:employeeId': lazy(() =>
    import('./employees/EmployeeCardPage').then((module) => ({
      default: module.EmployeeCardPage,
    })),
  ),
  // Add and edit are one screen (one chunk).
  '/employees/:employeeId/edit': lazy(() =>
    import('./employees/EmployeeFormPage').then((module) => ({
      default: module.EmployeeFormPage,
    })),
  ),
  '/manual': lazy(() =>
    import('./manual/ManualHandlingPage').then((module) => ({
      default: module.ManualHandlingPage,
    })),
  ),
  '/manual/approvals': lazy(() =>
    import('./manual/ApprovalsPage').then((module) => ({ default: module.ApprovalsPage })),
  ),
  '/templates': lazy(() =>
    import('./templates/TemplatesPage').then((module) => ({ default: module.TemplatesPage })),
  ),
  '/templates/new': lazy(() =>
    import('./templates/TemplateUploadPage').then((module) => ({
      default: module.TemplateUploadPage,
    })),
  ),
  '/templates/:templateId': lazy(() =>
    import('./templates/TemplateDetailsPage').then((module) => ({
      default: module.TemplateDetailsPage,
    })),
  ),
  '/templates/:templateId/positions': lazy(() =>
    import('./templates/editor/TemplatePositionsPage').then((module) => ({
      default: module.TemplatePositionsPage,
    })),
  ),
  '/settings': lazy(() =>
    import('./settings/SettingsPage').then((module) => ({ default: module.SettingsPage })),
  ),
  '/users': lazy(() =>
    import('./users/UsersPage').then((module) => ({ default: module.UsersPage })),
  ),
  ...(import.meta.env.DEV && {
    '/demo/components': lazy(() =>
      import('./demo/ComponentsDemoPage').then((module) => ({
        default: module.ComponentsDemoPage,
      })),
    ),
  }),
};

function pageElement(page: AdminPage) {
  const Page = PAGE_COMPONENTS[page.path];
  if (!Page) return <PlaceholderPage page={page} />;
  return (
    <Suspense fallback={<PageLoader />}>
      <Page />
    </Suspense>
  );
}

/**
 * The staff area. Every management page comes from ADMIN_PAGES and is wrapped in its role
 * check. Phase 5 adds each real screen to PAGE_COMPONENTS.
 */
export const staffRoutes: RouteObject[] = [
  {
    element: <StaffRoot />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              {
                // Inside the layout, so a crashing screen keeps the menu.
                errorElement: <RouteErrorBoundary />,
                children: [
                  ...ADMIN_PAGES.map((page) => ({
                    path: page.path,
                    element: <RequireRole roles={page.roles}>{pageElement(page)}</RequireRole>,
                  })),
                  { path: '*', element: <NotFoundPage /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];
