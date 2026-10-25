import type { RouteObject } from 'react-router';
import { RouteErrorBoundary } from '../components/feedback/RouteErrorBoundary';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { RequireRole } from './auth/RequireRole';
import { AdminLayout } from './layout/AdminLayout';
import { ADMIN_PAGES } from './navigation';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { StaffRoot } from './StaffRoot';

/**
 * The staff area. Every management page comes from ADMIN_PAGES and is wrapped in its role
 * check. Phase 5 swaps a PlaceholderPage for the real screen (a `lazy` route if it is large).
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
                    element: (
                      <RequireRole roles={page.roles}>
                        <PlaceholderPage page={page} />
                      </RequireRole>
                    ),
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
