import { ERROR_MESSAGES } from '@doc-signing/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { he } from '../../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, renderRoutes } from '../../test/render';

const emailField = () => screen.getByLabelText(he.login.email);
const passwordField = () => screen.getByLabelText(he.login.password);
const submit = () => screen.getByRole('button', { name: he.login.submit });

async function openLogin(routes: Parameters<typeof stubApi>[0] = {}) {
  const fetchMock = stubApi({ 'GET /api/auth/me': meAnswer(null), ...routes });
  const rendered = renderRoutes('/login');
  await screen.findByRole('form', { name: he.login.title });
  return { fetchMock, ...rendered };
}

const loginCalls = (fetchMock: Awaited<ReturnType<typeof openLogin>>['fetchMock']) =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/auth/login');

describe('LoginPage', () => {
  it('shows the organization, the system name, two fields and one button', async () => {
    await openLogin();
    expect(screen.getByText(he.app.organization)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: he.app.systemName })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('posts the form and lets the browser fill only the right fields', async () => {
    await openLogin();
    const form = screen.getByRole('form', { name: he.login.title });

    expect(form).toHaveAttribute('method', 'post');
    expect(emailField()).toHaveAttribute('autocomplete', 'username');
    expect(passwordField()).toHaveAttribute('autocomplete', 'current-password');
    expect(passwordField()).toHaveAttribute('type', 'password');
  });

  it('shows Hebrew field errors and calls nothing when fields are empty or wrong', async () => {
    const { fetchMock, user } = await openLogin();

    await user.click(submit());
    expect(screen.getByText(he.login.emailRequired)).toBeInTheDocument();
    expect(screen.getByText(he.login.passwordRequired)).toBeInTheDocument();

    await user.type(emailField(), 'not-an-email');
    await user.click(submit());
    expect(screen.getByText(he.login.emailInvalid)).toBeInTheDocument();
    expect(loginCalls(fetchMock)).toHaveLength(0);
  });

  it('removes a field error as soon as the user types in that field', async () => {
    const { user } = await openLogin();
    await user.click(submit());

    await user.type(emailField(), 'a');
    expect(screen.queryByText(he.login.emailRequired)).not.toBeInTheDocument();
    expect(screen.getByText(he.login.passwordRequired)).toBeInTheDocument();
  });

  it('sends the email lowercased and trimmed, as the shared schema says', async () => {
    const { fetchMock, user } = await openLogin({
      'POST /api/auth/login': () => jsonResponse(200, managerUser),
    });
    await user.type(emailField(), '  Manager@Doc-Signing.local ');
    await user.type(passwordField(), 'secret');
    await user.click(submit());

    await screen.findByRole('heading', { level: 1, name: he.nav.dashboard });
    const body = loginCalls(fetchMock)[0]?.[1]?.body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toEqual({ email: managerUser.email, password: 'secret' });
  });

  it('shows one message for a wrong email or password, and clears the password', async () => {
    const { user } = await openLogin({
      'POST /api/auth/login': () => apiErrorResponse(401, 'INVALID_CREDENTIALS'),
    });
    await user.type(emailField(), 'someone@doc-signing.local');
    await user.type(passwordField(), 'wrong');
    await user.click(submit());

    expect(await screen.findByRole('alert')).toHaveTextContent(ERROR_MESSAGES.INVALID_CREDENTIALS);
    expect(passwordField()).toHaveValue('');
  });

  it('shows the API limit message and when to try again', async () => {
    const { user } = await openLogin({
      'POST /api/auth/login': () =>
        apiErrorResponse(429, 'TOO_MANY_REQUESTS', { 'Retry-After': '600' }),
    });
    await user.type(emailField(), 'someone@doc-signing.local');
    await user.type(passwordField(), 'wrong');
    await user.click(submit());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(ERROR_MESSAGES.TOO_MANY_REQUESTS);
    expect(alert).toHaveTextContent(he.login.retryInMinutes(10));
  });

  it('keeps nothing in browser storage, and no password in the address', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { router, user } = await openLogin({
      'POST /api/auth/login': () => jsonResponse(200, managerUser),
    });
    await user.type(emailField(), managerUser.email);
    await user.type(passwordField(), 'secret');
    await user.click(submit());

    await screen.findByRole('heading', { level: 1, name: he.nav.dashboard });
    expect(setItem).not.toHaveBeenCalled();
    expect(router.state.location.search).toBe('');
  });
});
