import { screen } from '@testing-library/react';
import { he } from '../../../i18n/he';
import { jsonResponse, stubApi } from '../../../test/fetch-stub';
import { managerUser, meAnswer, renderRoutes } from '../../../test/render';
import { card, DEPARTMENTS, EMPLOYEE_ID, listItem, page } from '../../employees/employees.fixtures';
import { readyTemplate, template } from '../../templates/templates.fixtures';
import { report, TEMPLATE_B_ID } from './rounds.fixtures';

/** Helpers shared by the wizard's page tests (steps 1–4 and 5–7). */

const texts = he.newRound;
export const PREVIEW = 'POST /api/rounds/recipients-preview';
export const SEARCH = 'POST /api/employees/search';
export const TEMPLATES = 'GET /api/templates?page=1&pageSize=100';
export const notReady = { ...template, id: TEMPLATE_B_ID, name: 'תבנית חלקית' };

export type Answer = (init: RequestInit) => Response | Promise<Response>;

export function stub(routes: Record<string, Answer> = {}) {
  return stubApi({
    'GET /api/auth/me': meAnswer(managerUser),
    'GET /api/departments': () => jsonResponse(200, { items: DEPARTMENTS }),
    [TEMPLATES]: () => jsonResponse(200, page([readyTemplate, notReady])),
    [SEARCH]: () => jsonResponse(200, page([listItem])),
    [PREVIEW]: () => jsonResponse(200, report()),
    [`GET /api/employees/${EMPLOYEE_ID}`]: () => jsonResponse(200, card),
    ...routes,
  });
}

export type FetchMock = ReturnType<typeof stub>;

export const callsTo = (mock: FetchMock, route: string) =>
  mock.mock.calls.filter(
    ([url, init]) => `${init?.method ?? 'GET'} ${typeof url === 'string' ? url : ''}` === route,
  );

export const text = (value: unknown) => (typeof value === 'string' ? value : '');

export const bodyOf = (mock: FetchMock, route: string, index = 0): unknown =>
  JSON.parse(text(callsTo(mock, route)[index]?.[1]?.body));

export type Rendered = ReturnType<typeof renderRoutes>;

export async function openWizard(entry: Parameters<typeof renderRoutes>[0] = '/rounds/new') {
  const result = renderRoutes(entry);
  await screen.findByRole('heading', { level: 1, name: he.nav.newRound }, { timeout: 5000 });
  return result;
}

export const nextButton = () => screen.getByRole('button', { name: texts.next });
export const stepTitle = (name: string) => screen.findByRole('heading', { level: 2, name });

export async function toDocument({ user }: Rendered, mode?: 'by_department') {
  await user.type(screen.getByLabelText(texts.name.label, { exact: false }), 'חוזה שנתי');
  if (mode)
    await user.click(screen.getByRole('radio', { name: new RegExp(texts.name.modes[mode]) }));
  await user.click(nextButton());
  await stepTitle(texts.document.title);
}

export async function toRecipients(result: Rendered) {
  await toDocument(result);
  await result.user.click(
    await screen.findByRole('radio', { name: new RegExp(readyTemplate.name) }),
  );
  await result.user.click(nextButton());
  await stepTitle(texts.recipients.title);
}

export async function chooseAll({ user }: Rendered) {
  await user.click(screen.getByRole('checkbox', { name: texts.recipients.all }));
}

export async function toSummary(result: Rendered) {
  await result.user.click(nextButton());
  await stepTitle(texts.summary.title);
  await screen.findByRole('list', { name: texts.summary.countsLabel });
}

export function tile(key: string) {
  const element = document.querySelector(`[data-count="${key}"] [data-value]`);
  return element?.textContent;
}
