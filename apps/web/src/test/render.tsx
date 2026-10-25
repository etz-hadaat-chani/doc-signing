import type { AuthUser } from '@doc-signing/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, type InitialEntry, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { staffRoutes } from '../admin/staff-routes';
import { AppProviders } from '../app/AppProviders';
import { createQueryClient } from '../app/queryClient';
import { jsonResponse } from './fetch-stub';

export const managerUser: AuthUser = {
  id: '6f1c2b8e-4c1a-4d2e-9b8f-1a2b3c4d5e6f',
  email: 'manager@doc-signing.local',
  fullName: 'מנהלת מערכת',
  role: 'manager',
};

export const officerUser: AuthUser = {
  id: '7a2d3c9f-5d2b-4e3f-8c9a-2b3c4d5e6f70',
  email: 'officer@doc-signing.local',
  fullName: 'ממונה צפייה',
  role: 'officer',
};

/** A `GET /api/auth/me` answer for stubApi: the user, or 401 for nobody signed in. */
export function meAnswer(user: AuthUser | null) {
  return () =>
    user
      ? jsonResponse(200, user)
      : jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } });
}

/** Renders routes (default: the staff area) at an address, with the real theme and cache setup. */
export function renderRoutes(entry: InitialEntry, routes: RouteObject[] = staffRoutes) {
  const queryClient = createQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
  const user = userEvent.setup();
  render(
    <AppProviders>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppProviders>,
  );
  return { router, queryClient, user };
}
