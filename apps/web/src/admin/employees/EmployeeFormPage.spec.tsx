import { errorMessage } from '@doc-signing/shared';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, renderRoutes } from '../../test/render';
import { card, DEPARTMENTS, EMPLOYEE_ID, history, page } from './employees.fixtures';

const fields = he.employees.fields;
const text = he.employees.form;
const CARD = `GET /api/employees/${EMPLOYEE_ID}`;

function stubForm(answers: Record<string, (init: RequestInit) => Response> = {}) {
  return stubApi({
    'GET /api/auth/me': meAnswer(managerUser),
    'GET /api/departments': () => jsonResponse(200, { items: DEPARTMENTS }),
    [CARD]: () => jsonResponse(200, card),
    [`GET /api/employees/${EMPLOYEE_ID}/assignments?page=1&pageSize=25`]: () =>
      jsonResponse(200, page(history)),
    ...answers,
  });
}

const field = (name: string) => screen.getByRole('textbox', { name });
/** The JSON body of the first call with this method. */
function bodyOf(mock: ReturnType<typeof stubForm>, method: string): unknown {
  const body = mock.mock.calls.find(([, init]) => init?.method === method)?.[1]?.body;
  return typeof body === 'string' ? JSON.parse(body) : undefined;
}

async function openAdd() {
  const result = renderRoutes('/employees/new');
  await screen.findByRole('heading', { level: 1, name: text.addTitle }, { timeout: 5000 });
  return result;
}

async function openEdit() {
  const result = renderRoutes(`/employees/${EMPLOYEE_ID}/edit`);
  await screen.findByRole(
    'heading',
    { level: 1, name: text.editTitle('עובדת לדוגמה') },
    { timeout: 5000 },
  );
  return result;
}

describe('EmployeeFormPage: add', () => {
  it('reminds that the next Har Gal import overwrites what is typed', async () => {
    stubForm();
    await openAdd();
    expect(screen.getByText(text.harGalReminder)).toBeInTheDocument();
  });

  it('shows Hebrew errors next to each field and sends nothing', async () => {
    const fetchMock = stubForm();
    const { user } = await openAdd();
    await user.type(field(fields.idNumber), '000000019');
    await user.type(field(fields.mobile), '123');
    await user.type(field(fields.birthDate), '1980-05-03');
    await user.click(screen.getByRole('button', { name: text.save }));

    expect(field(fields.employeeNumber)).toHaveAccessibleDescription(text.required);
    expect(field(fields.idNumber)).toHaveAccessibleDescription(errorMessage('INVALID_ID_NUMBER'));
    expect(field(fields.firstName)).toHaveAccessibleDescription(text.required);
    expect(field(fields.mobile)).toHaveAccessibleDescription(errorMessage('INVALID_PHONE'));
    expect(field(fields.birthDate)).toHaveAccessibleDescription(text.dateInvalid);
    expect(screen.getByRole('combobox', { name: fields.department })).toHaveAccessibleDescription(
      text.chooseDepartment,
    );
    expect(screen.getByText(text.fixFields)).toBeInTheDocument();
    expect(field(fields.employeeNumber)).toHaveFocus();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    // Typing clears that field's error.
    await user.type(field(fields.employeeNumber), '9002');
    expect(field(fields.employeeNumber)).not.toHaveAccessibleDescription(text.required);
  });

  it('lists departments by code and puts a 409 next to the ID number', async () => {
    const fetchMock = stubForm({
      'POST /api/employees': () => apiErrorResponse(409, 'ID_NUMBER_TAKEN'),
    });
    const { user } = await openAdd();
    await user.type(field(fields.employeeNumber), '9002');
    await user.type(field(fields.idNumber), '000000018');
    await user.type(field(fields.firstName), 'עובד');
    await user.type(field(fields.lastName), 'לדוגמה');
    await user.click(screen.getByRole('combobox', { name: fields.department }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '15 - מחלקה לדוגמה א',
      '19 - מחלקה לדוגמה ב',
    ]);
    await user.click(screen.getByRole('option', { name: '15 - מחלקה לדוגמה א' }));
    await user.click(screen.getByRole('button', { name: text.save }));

    await waitFor(() =>
      expect(field(fields.idNumber)).toHaveAccessibleDescription(errorMessage('ID_NUMBER_TAKEN')),
    );
    expect(bodyOf(fetchMock, 'POST')).toMatchObject({
      employeeNumber: '9002',
      idNumber: '000000018',
      departmentId: DEPARTMENTS[1]?.id,
      email: null,
    });
  });

  it('after adding: a notification and the new card', async () => {
    stubForm({ 'POST /api/employees': () => jsonResponse(201, card) });
    const { user, router } = await openAdd();
    await user.type(field(fields.employeeNumber), '9001');
    await user.type(field(fields.idNumber), '000000018');
    await user.type(field(fields.firstName), 'עובדת');
    await user.type(field(fields.lastName), 'לדוגמה');
    await user.click(screen.getByRole('combobox', { name: fields.department }));
    await user.click(screen.getByRole('option', { name: '15 - מחלקה לדוגמה א' }));
    await user.click(screen.getByRole('button', { name: text.save }));

    expect(await screen.findByText(text.created)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/employees/${EMPLOYEE_ID}`));
  });
});

describe('EmployeeFormPage: edit', () => {
  it('fills the form; the employee number is locked', async () => {
    stubForm();
    await openEdit();
    expect(field(fields.city)).toHaveValue('עיר לדוגמה');
    expect(field(fields.birthDate)).toHaveValue('03/05/1980');
    expect(field(fields.employeeNumber)).toBeDisabled();
    expect(screen.getByText(text.harGalReminder)).toBeInTheDocument();
  });

  it('sends only what changed, an emptied field as null, then refreshes the card', async () => {
    let saved = card;
    const fetchMock = stubForm({
      [CARD]: () => jsonResponse(200, saved),
      [`PATCH /api/employees/${EMPLOYEE_ID}`]: () => {
        saved = { ...card, city: 'עיר אחרת', mobile: null, updatedAt: '2026-10-26T08:00:00.000Z' };
        return jsonResponse(200, saved);
      },
    });
    const { user, router } = await openEdit();
    await user.clear(field(fields.city));
    await user.type(field(fields.city), 'עיר אחרת');
    await user.clear(field(fields.mobile));
    await user.click(screen.getByRole('checkbox', { name: fields.isActive }));
    await user.click(screen.getByRole('checkbox', { name: fields.isActive }));
    await user.click(screen.getByRole('button', { name: text.save }));

    expect(await screen.findByText(text.saved)).toBeInTheDocument();
    expect(bodyOf(fetchMock, 'PATCH')).toEqual({ city: 'עיר אחרת', mobile: null });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/employees/${EMPLOYEE_ID}`));
    // The card was read again after the save, so it shows the stored values.
    await screen.findByRole('heading', { level: 1, name: 'עובדת לדוגמה' });
    await waitFor(() =>
      expect(
        screen.getByText(fields.mobile, { selector: 'dt' }).nextElementSibling,
      ).toHaveTextContent(he.employees.emptyValue),
    );
  });

  it('marks an employee inactive by hand', async () => {
    const fetchMock = stubForm({
      [`PATCH /api/employees/${EMPLOYEE_ID}`]: () =>
        jsonResponse(200, { ...card, isActive: false }),
    });
    const { user } = await openEdit();
    await user.click(screen.getByRole('checkbox', { name: fields.isActive }));
    await user.click(screen.getByRole('button', { name: text.save }));
    await screen.findByText(text.saved);
    expect(bodyOf(fetchMock, 'PATCH')).toEqual({ isActive: false });
  });

  it('nothing changed: says so and sends nothing', async () => {
    const fetchMock = stubForm();
    const { user } = await openEdit();
    await user.click(screen.getByRole('button', { name: text.save }));
    expect(await screen.findByText(text.noChanges)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('an error that belongs to no field is a notification', async () => {
    stubForm({ [`PATCH /api/employees/${EMPLOYEE_ID}`]: () => apiErrorResponse(404, 'NOT_FOUND') });
    const { user } = await openEdit();
    await user.clear(field(fields.city));
    await user.type(field(fields.city), 'עיר אחרת');
    await user.click(screen.getByRole('button', { name: text.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent(errorMessage('NOT_FOUND'));
  });
});
