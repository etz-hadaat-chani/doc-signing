import { errorMessage, type RoundDetails } from '@doc-signing/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../i18n/he';
import { jsonResponse, stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, officerUser, renderRoutes } from '../../test/render';
import {
  counts,
  DEPT_A,
  DEPT_B,
  details,
  detailsPath,
  paged,
  ROUND_ID,
  row,
  searchPath,
} from './round-details.fixtures';

const text = he.rounds.files;

function stubFiles(round: RoundDetails = details, user = managerUser) {
  return stubApi({
    'GET /api/auth/me': meAnswer(user),
    [`GET ${detailsPath}`]: () => jsonResponse(200, round),
    // Any table page: the filters are what this spec looks at.
    ...Object.fromEntries(
      [
        'page=1&pageSize=25',
        'status=sent&dept=' + DEPT_A + '&returned=true&page=1&pageSize=25',
        `dept=${DEPT_B}&page=1&pageSize=25`,
      ].map((query) => [
        `GET /api/rounds/${ROUND_ID}/assignments?${query}`,
        () => jsonResponse(200, paged([row])),
      ]),
    ),
    [`POST ${searchPath}`]: () => jsonResponse(200, paged([row])),
  });
}

async function openFiles(entry = `/rounds/${ROUND_ID}`, round = details, user = managerUser) {
  const fetchMock = stubFiles(round, user);
  const rendered = renderRoutes(entry);
  await screen.findByRole('button', { name: text.export });
  return { ...rendered, fetchMock };
}

const frame = () => screen.getByTestId<HTMLIFrameElement>('download-frame');

/** What the API would show in the frame for an error, then its `load`. */
function frameAnswers(body: string) {
  const doc = frame().contentDocument;
  if (!doc) throw new Error('no frame document');
  // jsdom leaves the navigated frame's document empty: give it a body to show the answer in.
  const html = doc.documentElement ?? doc.appendChild(doc.createElement('html'));
  const page = doc.body ?? html.appendChild(doc.createElement('body'));
  page.textContent = body;
  fireEvent.load(frame());
}

const apiError = (code: string) => JSON.stringify({ error: { code, message: 'x' } });

describe('RoundFiles (export, ZIP)', () => {
  it('export opens the table filters in the frame, never the search text', async () => {
    const { user, fetchMock } = await openFiles(
      `/rounds/${ROUND_ID}?status=sent&dept=${DEPT_A}&returned=true`,
    );
    await user.type(screen.getByRole('searchbox', { name: he.filters.search }), 'לדוגמה{Enter}');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
    );

    await user.click(screen.getByRole('button', { name: text.export }));
    const url = frame().getAttribute('src') ?? '';
    expect(url).toBe(`/api/rounds/${ROUND_ID}/export?status=sent&dept=${DEPT_A}&returned=true`);
    expect(decodeURIComponent(url)).not.toContain('לדוגמה');
    expect(url).not.toMatch(/[?&](q|page|pageSize)=/);
  });

  it('ZIP: the whole round, or the chosen department; never fetched into memory', async () => {
    const { user, fetchMock } = await openFiles();
    await user.click(screen.getByRole('button', { name: text.zip }));
    expect(frame().getAttribute('src')).toBe(`/api/rounds/${ROUND_ID}/download`);

    await user.click(screen.getByRole('combobox', { name: he.filters.department }));
    await user.click(screen.getByRole('option', { name: '120 - מחלקה לדוגמה ב' }));
    await user.click(await screen.findByRole('button', { name: text.zipDepartment }));
    expect(frame().getAttribute('src')).toBe(`/api/rounds/${ROUND_ID}/download?dept=${DEPT_B}`);

    const urls = fetchMock.mock.calls.map(([url]) => (typeof url === 'string' ? url : ''));
    expect(urls.some((url) => url.includes('/download') || url.includes('/export'))).toBe(false);
  });

  it('shows 409 "no signed files" and 429 "download running" in Hebrew', async () => {
    const { user } = await openFiles();
    await user.click(screen.getByRole('button', { name: text.zip }));
    frameAnswers(apiError('ROUND_HAS_NO_SIGNED_FILES'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      errorMessage('ROUND_HAS_NO_SIGNED_FILES'),
    );
    await user.click(screen.getByRole('button', { name: he.common.close }));

    await user.click(screen.getByRole('button', { name: text.zip }));
    frameAnswers(apiError('DOWNLOAD_IN_PROGRESS'));
    // The first notice may still be closing: wait for the new text.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(errorMessage('DOWNLOAD_IN_PROGRESS')),
    );
  });

  it('a 401 in the frame signs out like any staff request (to the login page)', async () => {
    const { user, router } = await openFiles();
    await user.click(screen.getByRole('button', { name: text.export }));
    frameAnswers(apiError('UNAUTHORIZED'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a page that is not ours shows the "unexpected answer" text; an empty one nothing', async () => {
    const { user } = await openFiles();
    await user.click(screen.getByRole('button', { name: text.export }));
    frameAnswers('');
    expect(screen.queryByRole('alert')).toBeNull();

    await user.click(screen.getByRole('button', { name: text.export }));
    frameAnswers('<h1>blocked</h1>');
    expect(await screen.findByRole('alert')).toHaveTextContent(he.feedback.unexpectedText);
  });

  it('ignores the empty frame loading by itself (no click yet)', async () => {
    await openFiles();
    frameAnswers(apiError('ROUND_HAS_NO_SIGNED_FILES'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('disables the ZIP when nothing is signed, and says why', async () => {
    await openFiles(`/rounds/${ROUND_ID}`, {
      ...details,
      counts: { ...details.counts, byStatus: counts({ sent: 10 }) },
    });
    expect(screen.getByRole('button', { name: text.zip })).toBeDisabled();
    expect(screen.getByText(text.zipNone)).toBeInTheDocument();
  });

  it('gives an officer both buttons', async () => {
    await openFiles(`/rounds/${ROUND_ID}`, details, officerUser);
    expect(screen.getByRole('button', { name: text.export })).toBeEnabled();
    expect(screen.getByRole('button', { name: text.zip })).toBeEnabled();
  });
});
