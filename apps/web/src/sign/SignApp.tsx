import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { createQueryClient } from '../app/queryClient';
import { signRoutes } from './sign-routes';

/**
 * The employee signing area (phase 6). Its own router and data cache, and no staff code: it
 * never calls /api/auth/* and a 401 here will mean "signing session expired" (6.x), never
 * "go to the staff login". Calls go through the plain request() (api/http.ts).
 */
const queryClient = createQueryClient();
const router = createBrowserRouter(signRoutes);

export function SignApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
