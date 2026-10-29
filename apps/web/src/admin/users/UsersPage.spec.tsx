import { errorMessage, type StaffUser } from '@doc-signing/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, renderRoutes } from '../../test/render';
import { STAFF, usersPage } from './users.fixtures';

const text = he.users;
const LIST = 'GET /api/users?page=1&pageSize=25';
const PASSWORD = 'correct horse battery';
function staff(index: number): StaffUser {
  const user = STAFF[index];
  if (!user) throw new Error('fixtures');
  return user;
}
const otherManager = staff(1);
const officer = staff(2);
const urlOf = (url: unknown) => (typeof url === 'string' ? url : '');

/** A JSON request body, read back. */
const bodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;

function stubUsers(answers: { create?: () => Response; update?: (id: string) => Response } = {}) {
  const routes: Record<string, (init: RequestInit) => Response> = {
    'GET /api/auth/me': meAnswer(managerUser),
    [LIST]: () => jsonResponse(200, usersPage()),
    'POST /api/users': (init) =>
      answers.create?.() ?? jsonResponse(201, { ...officer, ...(bodyOf(init) as object) }),
  };
  for (const user of STAFF) {
    routes[`PATCH /api/users/${user.id}`] = (init) =>
      answers.update?.(user.id) ?? jsonResponse(200, { ...user, ...(bodyOf(init) as object) });
  }
  return stubApi(routes);
}

type FetchMock = ReturnType<typeof stubUsers>;

const sent = (mock: FetchMock, method: string) =>
  mock.mock.calls
    .filter(([, init]) => init?.method === method)
    .map(([url, init]) => ({ url: urlOf(url), body: bodyOf(init) }));

/** No address ever holds the password; no notification shows it. */
function expectPasswordNowhere(mock: FetchMock) {
  for (const [url] of mock.mock.calls) expect(urlOf(url)).not.toContain('horse');
  expect(document.body.textContent).not.toContain(PASSWORD);
}

async function openPage() {
  const result = renderRoutes('/users');
  await screen.findByRole('table', { name: text.listCaption }, { timeout: 5000 });
  await screen.findByText(otherManager.fullName);
  return result;
}

const rowOf = (user: StaffUser) =>
  screen.getByRole('group', { name: text.actions.rowLabel(user.fullName) });

describe('UsersPage', () => {
  it('lists name, email, role, state and last sign-in', async () => {
    stubUsers();
    await openPage();
    const rows = within(screen.getByRole('table', { name: text.listCaption })).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent(`${managerUser.fullName} ${text.you}`);
    expect(rows[1]).toHaveTextContent('28/10/2026 08:15');
    expect(rows[2]).toHaveTextContent(text.neverLoggedIn);
    expect(rows[3]).toHaveTextContent(he.roles.officer);
    expect(within(rows[3] as HTMLElement).getByText(text.inactive)).toBeInTheDocument();
  });

  it("the manager's own row has no disable and no demote; another manager's has both", async () => {
    stubUsers();
    await openPage();
    const own = screen.getByRole('group', { name: text.actions.rowLabel(managerUser.fullName) });
    expect(
      within(own)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([text.actions.resetPassword]);
    expect(
      within(rowOf(otherManager))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([text.actions.makeOfficer, text.actions.disable, text.actions.resetPassword]);
    expect(
      within(rowOf(officer))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([text.actions.makeManager, text.actions.enable, text.actions.resetPassword]);
  });

  it('adds a user: errors first, then one POST; the dialog opens empty again', async () => {
    const fetchMock = stubUsers();
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: text.add }));
    let dialog = await screen.findByRole('dialog', { name: text.dialogs.addTitle });
    await user.click(within(dialog).getByRole('button', { name: text.dialogs.addConfirm }));
    expect(
      within(dialog).getByLabelText(text.fields.fullName, { exact: false, selector: 'input' }),
    ).toHaveAccessibleDescription(text.errors.required);
    expect(sent(fetchMock, 'POST')).toEqual([]);

    const password = within(dialog).getByLabelText(text.fields.password, {
      exact: false,
      selector: 'input',
    });
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(
      within(dialog).getByLabelText(text.fields.email, { exact: false, selector: 'input' }),
    ).toHaveAttribute('autocomplete', 'off');
    await user.type(
      within(dialog).getByLabelText(text.fields.fullName, { exact: false, selector: 'input' }),
      'משתמש חדש',
    );
    await user.type(
      within(dialog).getByLabelText(text.fields.email, { exact: false, selector: 'input' }),
      'New@Example.test',
    );
    await user.click(within(dialog).getByRole('radio', { name: text.roleHints.manager }));
    await user.type(password, PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: text.dialogs.addConfirm }));

    expect(await screen.findByText(text.done.created)).toBeInTheDocument();
    expect(sent(fetchMock, 'POST')).toEqual([
      {
        url: '/api/users',
        body: {
          fullName: 'משתמש חדש',
          email: 'new@example.test',
          role: 'manager',
          password: PASSWORD,
        },
      },
    ]);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: text.dialogs.addTitle })).not.toBeInTheDocument(),
    );
    expectPasswordNowhere(fetchMock);

    await user.click(screen.getByRole('button', { name: text.add }));
    dialog = await screen.findByRole('dialog', { name: text.dialogs.addTitle });
    expect(
      within(dialog).getByLabelText(text.fields.password, { exact: false, selector: 'input' }),
    ).toHaveValue('');
    expect(
      within(dialog).getByLabelText(text.fields.email, { exact: false, selector: 'input' }),
    ).toHaveValue('');
  });

  it('EMAIL_TAKEN shows under the email; the dialog stays open', async () => {
    stubUsers({ create: () => apiErrorResponse(409, 'EMAIL_TAKEN') });
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: text.add }));
    const dialog = await screen.findByRole('dialog', { name: text.dialogs.addTitle });
    await user.type(
      within(dialog).getByLabelText(text.fields.fullName, { exact: false, selector: 'input' }),
      'שם',
    );
    await user.type(
      within(dialog).getByLabelText(text.fields.email, { exact: false, selector: 'input' }),
      'a@example.test',
    );
    await user.type(
      within(dialog).getByLabelText(text.fields.password, { exact: false, selector: 'input' }),
      PASSWORD,
    );
    await user.click(within(dialog).getByRole('button', { name: text.dialogs.addConfirm }));
    await waitFor(() =>
      expect(
        within(dialog).getByLabelText(text.fields.email, { exact: false, selector: 'input' }),
      ).toHaveAccessibleDescription(errorMessage('EMAIL_TAKEN')),
    );
  });

  it('resets a password: checked first, sent in the body only, the field emptied after', async () => {
    const fetchMock = stubUsers();
    const { user } = await openPage();
    await user.click(
      within(rowOf(otherManager)).getByRole('button', { name: text.actions.resetPassword }),
    );
    let dialog = await screen.findByRole('dialog', { name: text.dialogs.resetTitle });
    expect(dialog).toHaveTextContent(text.dialogs.resetText);
    const field = () =>
      within(dialog).getByLabelText(text.fields.newPassword, { exact: false, selector: 'input' });
    expect(field()).toHaveAttribute('type', 'password');
    expect(field()).toHaveAttribute('autocomplete', 'new-password');

    await user.type(field(), 'short');
    await user.click(within(dialog).getByRole('button', { name: text.dialogs.resetConfirm }));
    expect(field()).toHaveAccessibleDescription(text.errors.passwordLength(10, 128));
    expect(sent(fetchMock, 'PATCH')).toEqual([]);

    await user.clear(field());
    await user.type(field(), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: text.dialogs.resetConfirm }));
    expect(await screen.findByText(text.done.passwordReset)).toBeInTheDocument();
    expect(sent(fetchMock, 'PATCH')).toEqual([
      { url: `/api/users/${otherManager.id}`, body: { password: PASSWORD } },
    ]);
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: text.dialogs.resetTitle }),
      ).not.toBeInTheDocument(),
    );
    expectPasswordNowhere(fetchMock);

    await user.click(
      within(rowOf(otherManager)).getByRole('button', { name: text.actions.resetPassword }),
    );
    dialog = await screen.findByRole('dialog', { name: text.dialogs.resetTitle });
    expect(field()).toHaveValue('');
  });

  it('a cancelled reset forgets the typed password', async () => {
    stubUsers();
    const { user } = await openPage();
    const open = () =>
      user.click(within(rowOf(officer)).getByRole('button', { name: text.actions.resetPassword }));
    await open();
    let dialog = await screen.findByRole('dialog', { name: text.dialogs.resetTitle });
    await user.type(
      within(dialog).getByLabelText(text.fields.newPassword, { exact: false, selector: 'input' }),
      PASSWORD,
    );
    await user.click(within(dialog).getByRole('button', { name: he.common.cancel }));
    await open();
    dialog = await screen.findByRole('dialog', { name: text.dialogs.resetTitle });
    expect(
      within(dialog).getByLabelText(text.fields.newPassword, { exact: false, selector: 'input' }),
    ).toHaveValue('');
  });

  it('own password reset: the dialog says this computer stays signed in', async () => {
    stubUsers();
    const { user } = await openPage();
    const own = screen.getByRole('group', { name: text.actions.rowLabel(managerUser.fullName) });
    await user.click(within(own).getByRole('button', { name: text.actions.resetPassword }));
    const dialog = await screen.findByRole('dialog', { name: text.dialogs.resetTitle });
    expect(dialog).toHaveTextContent(text.dialogs.resetOwnText);
  });

  it('disables after a warning that the user is signed out everywhere; a 409 in Hebrew', async () => {
    const fetchMock = stubUsers({ update: () => apiErrorResponse(409, 'LAST_ACTIVE_MANAGER') });
    const { user } = await openPage();
    await user.click(
      within(rowOf(otherManager)).getByRole('button', { name: text.actions.disable }),
    );
    const dialog = await screen.findByRole('dialog', { name: text.dialogs.disableTitle });
    expect(dialog).toHaveTextContent('בכל מחשב');
    expect(dialog).toHaveTextContent(otherManager.email);
    await user.click(within(dialog).getByRole('button', { name: text.dialogs.disableConfirm }));
    expect(await screen.findByText(errorMessage('LAST_ACTIVE_MANAGER'))).toBeInTheDocument();
    expect(sent(fetchMock, 'PATCH')).toEqual([
      { url: `/api/users/${otherManager.id}`, body: { isActive: false } },
    ]);
  });

  it('changes a role after saying it applies from the next action; CANNOT_CHANGE_OWN_ACCESS in Hebrew', async () => {
    const fetchMock = stubUsers({
      update: () => apiErrorResponse(409, 'CANNOT_CHANGE_OWN_ACCESS'),
    });
    const { user } = await openPage();
    await user.click(
      within(rowOf(otherManager)).getByRole('button', { name: text.actions.makeOfficer }),
    );
    const dialog = await screen.findByRole('dialog', { name: text.dialogs.roleTitle });
    expect(dialog).toHaveTextContent(text.dialogs.toOfficer);
    await user.click(within(dialog).getByRole('button', { name: text.dialogs.roleConfirm }));
    expect(await screen.findByText(errorMessage('CANNOT_CHANGE_OWN_ACCESS'))).toBeInTheDocument();
    expect(sent(fetchMock, 'PATCH')).toEqual([
      { url: `/api/users/${otherManager.id}`, body: { role: 'officer' } },
    ]);
  });

  it('enables a disabled officer and reads the list again', async () => {
    const fetchMock = stubUsers();
    const { user } = await openPage();
    await user.click(within(rowOf(officer)).getByRole('button', { name: text.actions.enable }));
    const dialog = await screen.findByRole('dialog', { name: text.dialogs.enableTitle });
    await user.click(within(dialog).getByRole('button', { name: text.dialogs.enableConfirm }));
    expect(await screen.findByText(text.done.enabled)).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => url === LIST.slice(4))).toHaveLength(2),
    );
  });
});
