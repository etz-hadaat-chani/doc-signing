import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { createQueryClient } from '../app/queryClient';
import { staffRoutes } from './staff-routes';

const queryClient = createQueryClient();
const router = createBrowserRouter(staffRoutes);

/** The staff area: login and the management screens (A1–A12). */
export function StaffApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
