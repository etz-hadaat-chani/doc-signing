import { errorMessage, type SettingsItem } from '@doc-signing/shared';
import { focusManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, renderRoutes } from '../../test/render';
import { signatureLink, storedSettings } from './settings.fixtures';

const text = he.settings;
const numbers = he.newRound.settings;
const image = text.employerSignature;
const LINK = '/api/settings/employer-signature';

/** A JSON request body, read back. */
const bodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;

/** The settings API in memory: a PATCH changes what the next GET returns. */
function stubSettings(
  options: {
    stored?: SettingsItem;
    patch?: (body: unknown) => Response | null;
    upload?: () => Response;
  } = {},
) {
  let current: SettingsItem = options.stored ?? storedSettings;
  return stubApi({
    'GET /api/auth/me': meAnswer(managerUser),
    'GET /api/settings': () => jsonResponse(200, current),
    'PATCH /api/settings': (init) => {
      const body = bodyOf(init);
      const refused = options.patch?.(body);
      if (refused) return refused;
      current = { ...current, ...(body as Partial<SettingsItem>) };
      return jsonResponse(200, current);
    },
    [`GET ${LINK}`]: () => jsonResponse(200, signatureLink),
    [`POST ${LINK}`]: options.upload ?? (() => jsonResponse(201, signatureLink)),
  });
}

type FetchMock = ReturnType<typeof stubSettings>;

const callsTo = (mock: FetchMock, method: string, url: string) =>
  mock.mock.calls.filter(([path, init]) => path === url && (init?.method ?? 'GET') === method);

const patchBodies = (mock: FetchMock) =>
  callsTo(mock, 'PATCH', '/api/settings').map(([, init]) => bodyOf(init));

async function openPage() {
  const result = renderRoutes('/settings');
  await screen.findByRole('form', { name: text.title }, { timeout: 5000 });
  return result;
}

const box = (name: string) => screen.getByRole('textbox', { name });
const save = () => screen.getByRole('button', { name: text.save });

describe('SettingsPage', () => {
  it('prefills the stored values and sends only the one that changed', async () => {
    const fetchMock = stubSettings();
    const { user } = await openPage();
    expect(box(numbers.reminderIntervalDays)).toHaveValue('3');
    expect(screen.getByRole('radio', { name: numbers.unlimited })).toBeChecked();
    expect(box(text.sender.label)).toHaveValue('מערכת חתימות');
    expect(box(text.hrContact.phone)).toHaveValue('02-0000000');
    expect(screen.getByText(text.hrContact.note)).toBeInTheDocument();

    await user.clear(box(numbers.reminderIntervalDays));
    await user.type(box(numbers.reminderIntervalDays), '5');
    expect(screen.getByText(text.unsaved)).toBeInTheDocument();
    await user.click(save());

    expect(await screen.findByText(text.saved)).toBeInTheDocument();
    expect(patchBodies(fetchMock)).toEqual([{ reminderIntervalDays: 5 }]);
    // The settings were read again; the image link was never asked for.
    await waitFor(() => expect(callsTo(fetchMock, 'GET', '/api/settings')).toHaveLength(2));
    expect(callsTo(fetchMock, 'GET', LINK)).toHaveLength(0);
    expect(box(numbers.reminderIntervalDays)).toHaveValue('5');
    expect(screen.queryByText(text.unsaved)).not.toBeInTheDocument();
  });

  it('nothing changed → a note, no request', async () => {
    const fetchMock = stubSettings();
    const { user } = await openPage();
    await user.click(save());
    expect(await screen.findByText(text.unchanged)).toBeInTheDocument();
    expect(patchBodies(fetchMock)).toEqual([]);
  });

  it('a limit on reminders: radio then a number', async () => {
    const fetchMock = stubSettings();
    const { user } = await openPage();
    await user.click(screen.getByRole('radio', { name: numbers.limited }));
    await user.type(box(numbers.maxReminders), '4');
    await user.click(save());
    await screen.findByText(text.saved);
    expect(patchBodies(fetchMock)).toEqual([{ maxReminders: 4 }]);
  });

  it('dates: Enter adds a day (without saving), a day is removed, the whole list is sent', async () => {
    const fetchMock = stubSettings();
    const { user } = await openPage();
    const list = () => screen.getByRole('list', { name: text.skipDates.listLabel });
    expect(
      within(list())
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['03/10/2026', '10/10/2026']);

    await user.type(box(text.skipDates.dateLabel), '31/02/2027{Enter}');
    expect(box(text.skipDates.dateLabel)).toHaveAccessibleDescription(text.skipDates.notADay);
    await user.clear(box(text.skipDates.dateLabel));
    await user.type(box(text.skipDates.dateLabel), '5/10/2026{Enter}');
    expect(patchBodies(fetchMock)).toEqual([]);
    await user.click(screen.getByRole('button', { name: text.skipDates.remove('10/10/2026') }));
    expect(
      within(list())
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['03/10/2026', '05/10/2026']);
    expect(screen.getByText(`(${text.skipDates.count(2, 100)})`)).toBeInTheDocument();

    await user.click(save());
    await screen.findByText(text.saved);
    expect(patchBodies(fetchMock)).toEqual([{ reminderSkipDates: ['2026-10-03', '2026-10-05'] }]);
  });

  it('HR contact without phone and email: both boxes say so, nothing sent', async () => {
    const fetchMock = stubSettings();
    const { user } = await openPage();
    await user.clear(box(text.hrContact.phone));
    await user.click(save());
    expect(await screen.findByText(text.fixFields)).toBeInTheDocument();
    expect(box(text.hrContact.phone)).toHaveAccessibleDescription(text.hrContact.phoneOrEmail);
    expect(box(text.hrContact.email)).toHaveAccessibleDescription(text.hrContact.phoneOrEmail);
    expect(box(text.hrContact.phone)).toHaveFocus();
    expect(patchBodies(fetchMock)).toEqual([]);

    await user.type(box(text.hrContact.email), 'hr@example.test');
    await user.click(save());
    await screen.findByText(text.saved);
    expect(patchBodies(fetchMock)).toEqual([
      { hrContact: { name: 'משאבי אנוש לדוגמה', phone: null, email: 'hr@example.test' } },
    ]);
  });

  it("the server's 400 goes under its field, in our Hebrew", async () => {
    stubSettings({
      patch: () =>
        jsonResponse(400, {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'x',
            details: { fields: [{ field: 'senderName', code: 'INVALID_VALUE', message: 'x' }] },
          },
        }),
    });
    const { user } = await openPage();
    await user.type(box(text.sender.label), ' חדש');
    await user.click(save());
    await waitFor(() =>
      expect(box(text.sender.label)).toHaveAccessibleDescription(errorMessage('INVALID_VALUE')),
    );
  });

  it('another refusal → a notification with our text', async () => {
    stubSettings({ patch: () => apiErrorResponse(409, 'CONFLICT') });
    const { user } = await openPage();
    await user.type(box(text.sender.label), ' חדש');
    await user.click(save());
    expect(await screen.findByText(errorMessage('CONFLICT'))).toBeInTheDocument();
    expect(screen.getByText(text.unsaved)).toBeInTheDocument();
  });
});

describe('SettingsPage: employer signature image', () => {
  it('asks for the image link only on "show", never on load or window focus, and reuses it', async () => {
    const fetchMock = stubSettings();
    const { user } = await openPage();
    expect(screen.getByText(/600×300/)).toBeInTheDocument();

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(callsTo(fetchMock, 'GET', LINK)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: image.show }));
    const shown = await screen.findByRole('img', { name: image.imageAlt });
    expect(shown).toHaveAttribute('src', signatureLink.url);
    expect(shown).toHaveAttribute('referrerpolicy', 'no-referrer');

    await user.click(screen.getByRole('button', { name: image.hide }));
    await user.click(screen.getByRole('button', { name: image.show }));
    await screen.findByRole('img', { name: image.imageAlt });
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(callsTo(fetchMock, 'GET', LINK)).toHaveLength(1);
  });

  it('no image yet: says so, no "show" button', async () => {
    stubSettings({ stored: { ...storedSettings, employerSignature: null } });
    await openPage();
    expect(screen.getByText(image.none)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: image.show })).not.toBeInTheDocument();
  });

  it('refuses a file that is not .png before any request', async () => {
    const fetchMock = stubSettings();
    await openPage();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    // Past the picker's own filter, as a drop would be.
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'חתימה.jpg', { type: 'image/jpeg' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(he.upload.wrongType(image.accept));
    expect(screen.getByRole('button', { name: image.upload })).toBeDisabled();
    expect(callsTo(fetchMock, 'POST', LINK)).toHaveLength(0);
  });

  it("asks first, sends the PNG as a form, shows the server's refusal in Hebrew", async () => {
    const fetchMock = stubSettings({ upload: () => apiErrorResponse(400, 'INVALID_PNG_FILE') });
    const { user } = await openPage();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    await user.upload(input, new File(['png'], 'חתימה.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: image.upload }));

    const dialog = await screen.findByRole('dialog', { name: image.confirmTitle });
    expect(within(dialog).getByText(image.newOnly)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: image.confirm }));

    expect(await screen.findByText(errorMessage('INVALID_PNG_FILE'))).toBeInTheDocument();
    const [call] = callsTo(fetchMock, 'POST', LINK);
    const body = call?.[1]?.body;
    expect(body instanceof FormData && body.get('file')).toBeInstanceOf(File);
    // The file stays chosen for another try.
    expect(screen.getByText('חתימה.png')).toBeInTheDocument();
  });

  it('after an upload: a notification and the settings read again, the old link dropped', async () => {
    const fetchMock = stubSettings();
    const { user } = await openPage();
    await user.click(screen.getByRole('button', { name: image.show }));
    await screen.findByRole('img', { name: image.imageAlt });

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    await user.upload(input, new File(['png'], 'חתימה.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: image.upload }));
    const dialog = await screen.findByRole('dialog', { name: image.confirmTitle });
    await user.click(within(dialog).getByRole('button', { name: image.confirm }));

    expect(await screen.findByText(image.uploaded)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: image.imageAlt })).not.toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchMock, 'GET', '/api/settings')).toHaveLength(2));
    // The dialog's closing transition hides the page from the accessibility tree for a moment.
    await user.click(await screen.findByRole('button', { name: image.show }));
    await screen.findByRole('img', { name: image.imageAlt });
    expect(callsTo(fetchMock, 'GET', LINK)).toHaveLength(2);
  });
});
