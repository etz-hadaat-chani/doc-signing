import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { he } from '../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../test/fetch-stub';
import { managerUser, meAnswer, officerUser, renderRoutes } from '../test/render';
import { staffKeys, staffRequest } from './auth/staff-api';

const pageTitle = (name: string) => screen.findByRole('heading', { level: 1, name });

describe('staff routes', () => {
  it('sends a signed-out user to login, then back to the page wanted', async () => {
    let signedIn = false;
    stubApi({
      'GET /api/auth/me': () => meAnswer(signedIn ? managerUser : null)(),
      'POST /api/auth/login': () => {
        signedIn = true;
        return jsonResponse(200, managerUser);
      },
    });
    const { router, user } = renderRoutes('/templates?tab=2');

    await screen.findByRole('form', { name: he.login.title });
    expect(router.state.location.pathname).toBe('/login');
    // Remembered in router memory, not in the address.
    expect(router.state.location.search).toBe('');

    await user.type(screen.getByLabelText(he.login.email), managerUser.email);
    await user.type(screen.getByLabelText(he.login.password), 'secret');
    await user.click(screen.getByRole('button', { name: he.login.submit }));

    await pageTitle(he.nav.templates);
    expect(router.state.location.pathname).toBe('/templates');
    expect(router.state.location.search).toBe('?tab=2');
  });

  it('shows "no permission" when an officer types a manager address', async () => {
    stubApi({ 'GET /api/auth/me': meAnswer(officerUser) });
    renderRoutes('/templates');

    await pageTitle(he.feedback.noPermissionTitle);
    expect(screen.queryByRole('heading', { name: he.nav.templates })).not.toBeInTheDocument();
  });

  it('opens the components demo for a manager', async () => {
    stubApi({ 'GET /api/auth/me': meAnswer(managerUser) });
    renderRoutes('/demo/components');
    // A lazy chunk: its first load can be slow while other suites run in parallel.
    await screen.findByRole(
      'heading',
      { level: 1, name: he.nav.componentsDemo },
      { timeout: 5000 },
    );
    expect(await screen.findByRole('table', { name: he.demo.tableCaption })).toBeInTheDocument();
  });

  it('shows "no permission" to an officer on the components demo', async () => {
    stubApi({ 'GET /api/auth/me': meAnswer(officerUser) });
    renderRoutes('/demo/components');
    await pageTitle(he.feedback.noPermissionTitle);
    expect(screen.queryByRole('heading', { name: he.nav.componentsDemo })).not.toBeInTheDocument();
  });

  it.each([
    ['add', '/employees/new'],
    ['edit', '/employees/8b0c7d6e-1f2a-4b3c-9d4e-5f6a7b8c9d0e/edit'],
  ])('shows "no permission" to an officer on the employee %s address', async (_label, path) => {
    const fetchMock = stubApi({ 'GET /api/auth/me': meAnswer(officerUser) });
    renderRoutes(path);
    await pageTitle(he.feedback.noPermissionTitle);
    // The form's chunk never loads, so no employee is read either.
    expect(fetchMock.mock.calls.map(([url]) => (typeof url === 'string' ? url : ''))).toEqual([
      '/api/auth/me',
    ]);
  });

  it.each([
    ['list', '/templates'],
    ['upload', '/templates/new'],
    ['details', '/templates/8b0c7d6e-1f2a-4b3c-9d4e-5f6a7b8c9d0e'],
    ['positions', '/templates/8b0c7d6e-1f2a-4b3c-9d4e-5f6a7b8c9d0e/positions'],
  ])('shows "no permission" to an officer on the template %s address', async (_label, path) => {
    const fetchMock = stubApi({ 'GET /api/auth/me': meAnswer(officerUser) });
    renderRoutes(path);
    await pageTitle(he.feedback.noPermissionTitle);
    // The screen's chunk never loads, so no template is read either.
    expect(fetchMock.mock.calls.map(([url]) => (typeof url === 'string' ? url : ''))).toEqual([
      '/api/auth/me',
    ]);
  });

  it('shows "no permission" to an officer on the new round wizard (its chunk never loads)', async () => {
    const fetchMock = stubApi({ 'GET /api/auth/me': meAnswer(officerUser) });
    renderRoutes('/rounds/new');
    await pageTitle(he.feedback.noPermissionTitle);
    expect(screen.queryByRole('button', { name: he.newRound.next })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => (typeof url === 'string' ? url : ''))).toEqual([
      '/api/auth/me',
    ]);
  });

  it('shows "no permission" to an officer on the settings (no settings or image request)', async () => {
    const fetchMock = stubApi({ 'GET /api/auth/me': meAnswer(officerUser) });
    renderRoutes('/settings');
    await pageTitle(he.feedback.noPermissionTitle);
    expect(screen.queryByRole('form', { name: he.settings.title })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => (typeof url === 'string' ? url : ''))).toEqual([
      '/api/auth/me',
    ]);
  });

  it('lets an officer open the read-only pages', async () => {
    stubApi({ 'GET /api/auth/me': meAnswer(officerUser) });
    renderRoutes('/manual/approvals');
    await pageTitle(he.nav.approvals);
  });

  it('lets an officer open the rounds list and a round', async () => {
    const roundId = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
    stubApi({
      'GET /api/auth/me': meAnswer(officerUser),
      'GET /api/rounds?page=1&pageSize=25': () =>
        jsonResponse(200, { items: [], total: 0, page: 1, pageSize: 25 }),
      [`GET /api/rounds/${roundId}`]: () => apiErrorResponse(404, 'ROUND_NOT_FOUND'),
    });
    const { router } = renderRoutes('/rounds');
    await pageTitle(he.nav.rounds);
    await router.navigate(`/rounds/${roundId}`);
    await screen.findByRole('heading', { name: he.feedback.notFoundTitle });
  });

  it('a round address that is not a uuid shows "not found" without asking for it', async () => {
    const fetchMock = stubApi({ 'GET /api/auth/me': meAnswer(officerUser) });
    renderRoutes('/rounds/abc');
    await screen.findByRole('heading', { name: he.feedback.notFoundTitle });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/me']);
  });

  it('on a 401 from any staff request: back to login, staff data cleared, page remembered', async () => {
    stubApi({
      'GET /api/auth/me': meAnswer(managerUser),
      'GET /api/rounds': () => apiErrorResponse(401, 'UNAUTHORIZED'),
    });
    const { router, queryClient } = renderRoutes('/rounds');
    await pageTitle(he.nav.rounds);
    queryClient.setQueryData([...staffKeys.all, 'rounds'], { items: ['secret'] });

    await expect(staffRequest('/api/rounds', { schema: z.unknown() })).rejects.toThrow();

    await screen.findByRole('form', { name: he.login.title });
    expect(router.state.location.state).toEqual({ from: '/rounds' });
    expect(queryClient.getQueryData(staffKeys.me)).toBeNull();
    expect(queryClient.getQueryData([...staffKeys.all, 'rounds'])).toBeUndefined();
  });

  it('on a 403 re-checks who is signed in (the role may have changed)', async () => {
    let role = managerUser;
    const fetchMock = stubApi({
      'GET /api/auth/me': () => meAnswer(role)(),
      'GET /api/users': () => apiErrorResponse(403, 'FORBIDDEN'),
    });
    renderRoutes('/users');
    await pageTitle(he.nav.users);

    role = officerUser;
    await expect(staffRequest('/api/users', { schema: z.unknown() })).rejects.toThrow();

    await pageTitle(he.feedback.noPermissionTitle);
    const meCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/auth/me');
    expect(meCalls).toHaveLength(2);
  });

  it('logout ends the session on the server and returns to login without the old page', async () => {
    const fetchMock = stubApi({
      'GET /api/auth/me': meAnswer(managerUser),
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
    });
    const { router, queryClient, user } = renderRoutes('/settings');
    await pageTitle(he.nav.settings);

    await user.click(screen.getByRole('button', { name: he.topBar.logout }));

    await screen.findByRole('form', { name: he.login.title });
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/logout')).toBe(true);
    expect(router.state.location.state).toBeNull();
    await waitFor(() => expect(queryClient.getQueryData(staffKeys.me)).toBeNull());
  });

  it('still signs out here when the logout call fails', async () => {
    stubApi({
      'GET /api/auth/me': meAnswer(managerUser),
      'POST /api/auth/logout': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const { user } = renderRoutes('/');
    await pageTitle(he.nav.dashboard);

    await user.click(screen.getByRole('button', { name: he.topBar.logout }));
    await screen.findByRole('form', { name: he.login.title });
  });

  it('shows "not found" for an unknown address inside the shell', async () => {
    stubApi({ 'GET /api/auth/me': meAnswer(managerUser) });
    renderRoutes('/no-such-page');
    await pageTitle(he.feedback.notFoundTitle);
  });

  it('shows a retry when the server cannot be reached on start', async () => {
    stubApi({ 'GET /api/auth/me': () => Promise.reject(new TypeError('Failed to fetch')) });
    renderRoutes('/');

    expect(await screen.findByText(he.feedback.networkText, {}, { timeout: 5000 })).toBeVisible();
    expect(screen.getByRole('button', { name: he.feedback.retry })).toBeInTheDocument();
  });
});
