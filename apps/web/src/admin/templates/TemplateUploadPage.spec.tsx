import { errorMessage } from '@doc-signing/shared';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, renderRoutes } from '../../test/render';
import { DEPARTMENTS } from '../employees/employees.fixtures';
import { template, TEMPLATE_ID } from './templates.fixtures';

const text = he.templates.upload;
const form = he.templates.form;
const UPLOAD = 'POST /api/templates';

function stubUpload(answer: () => Response = () => jsonResponse(201, template)) {
  return stubApi({
    'GET /api/auth/me': meAnswer(managerUser),
    'GET /api/departments': () => jsonResponse(200, { items: DEPARTMENTS }),
    [UPLOAD]: answer,
    [`GET /api/templates/${TEMPLATE_ID}`]: () => jsonResponse(200, template),
  });
}

async function openPage() {
  const result = renderRoutes('/templates/new');
  await screen.findByRole('heading', { level: 1, name: text.title }, { timeout: 5000 });
  return result;
}

type Opened = Awaited<ReturnType<typeof openPage>>;

async function fillIn({ user }: Opened) {
  await user.type(screen.getByRole('textbox', { name: text.name }), 'חוזה לדוגמה');
  await user.click(screen.getByRole('combobox', { name: he.departmentPicker.label }));
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
    '15 - מחלקה לדוגמה א',
    '19 - מחלקה לדוגמה ב',
  ]);
  await user.click(screen.getByRole('option', { name: '19 - מחלקה לדוגמה ב' }));
  await user.click(screen.getByRole('option', { name: '15 - מחלקה לדוגמה א' }));
  await user.keyboard('{Escape}');
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input');
  await user.upload(input, new File(['%PDF-1.7'], 'חוזה.pdf', { type: 'application/pdf' }));
}

const submit = ({ user }: Opened) => user.click(screen.getByRole('button', { name: text.submit }));

function uploadBody(mock: ReturnType<typeof stubUpload>): FormData | undefined {
  const body = mock.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body;
  return body instanceof FormData ? body : undefined;
}

describe('TemplateUploadPage', () => {
  it('asks for a name, a department and a file before sending anything', async () => {
    const fetchMock = stubUpload();
    const result = await openPage();
    await submit(result);
    expect(screen.getByRole('textbox', { name: text.name })).toHaveAccessibleDescription(
      form.required,
    );
    expect(screen.getByText(form.chooseDepartments)).toBeInTheDocument();
    expect(screen.getByText(form.chooseFile)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: text.name })).toHaveFocus();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('sends the file, the name and each department (in code order), then opens the template', async () => {
    const fetchMock = stubUpload();
    const result = await openPage();
    await fillIn(result);
    await submit(result);

    expect(await screen.findByText(text.created)).toBeInTheDocument();
    await waitFor(() =>
      expect(result.router.state.location.pathname).toBe(`/templates/${TEMPLATE_ID}`),
    );
    const body = uploadBody(fetchMock);
    expect(body?.get('name')).toBe('חוזה לדוגמה');
    expect(body?.getAll('departmentIds')).toEqual([DEPARTMENTS[1]?.id, DEPARTMENTS[0]?.id]);
    expect(body?.get('file')).toBeInstanceOf(File);
  });

  it('a refused PDF shows our Hebrew reason, and the file stays chosen for another try', async () => {
    const fetchMock = stubUpload(() => apiErrorResponse(400, 'PDF_FORM_FIELDS'));
    const result = await openPage();
    await fillIn(result);
    await submit(result);

    expect(await screen.findByText(errorMessage('PDF_FORM_FIELDS'))).toBeInTheDocument();
    expect(screen.getByText(text.failed)).toBeInTheDocument();
    expect(screen.getByText('חוזה.pdf')).toBeInTheDocument();
    expect(result.router.state.location.pathname).toBe('/templates/new');

    await submit(result);
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2),
    );
  });

  it('an unknown department is marked on the departments field', async () => {
    stubUpload(() => apiErrorResponse(400, 'DEPARTMENT_NOT_FOUND'));
    const result = await openPage();
    await fillIn(result);
    await submit(result);
    expect(await screen.findByText(errorMessage('DEPARTMENT_NOT_FOUND'))).toBeInTheDocument();
  });

  it('a double click uploads once', async () => {
    let answer: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    const fetchMock = stubUpload(() => jsonResponse(201, template));
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input, init) =>
      init?.method === 'POST' || !original ? pending : original(input, init),
    );
    const result = await openPage();
    await fillIn(result);
    await result.user.dblClick(screen.getByRole('button', { name: text.submit }));
    answer(jsonResponse(201, template));
    await screen.findByText(text.created);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
});
