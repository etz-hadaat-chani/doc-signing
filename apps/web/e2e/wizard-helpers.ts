import { expect, type Page } from '@playwright/test';

// Shared by the round wizard e2e files (5.5, 7.1): moving through the steps of /rounds/new.

const SCREENS = 'test-results/round-wizard';

/**
 * The page in viewport-sized parts (`name`, `name-2`, …): Chromium draws Hebrew in another font
 * in one very tall capture.
 */
export async function screen(page: Page, name: string) {
  // Strings: the e2e files have no DOM types.
  const height = Number(await page.evaluate('document.documentElement.scrollHeight'));
  const view = page.viewportSize()?.height ?? 720;
  for (let part = 0; part * view < height; part += 1) {
    await page.evaluate(`window.scrollTo(0, ${String(part * view)})`);
    const suffix = part === 0 ? '' : `-${String(part + 1)}`;
    await page.screenshot({ path: `${SCREENS}/${name}${suffix}.png` });
  }
  await page.evaluate('window.scrollTo(0, 0)');
}

export async function next(page: Page) {
  await page.getByRole('button', { name: 'הבא', exact: true }).click();
}

/** Finds a fake employee by number in the picker (POST search) and clicks "add" / "choose". */
export async function pick(page: Page, employeeNumber: string, label: RegExp = /^הוספת /) {
  const search = page.getByRole('searchbox', { name: 'חיפוש' });
  await search.fill(employeeNumber);
  await search.press('Enter');
  await page
    .getByRole('table', { name: 'תוצאות החיפוש' })
    .getByRole('button', { name: label })
    .click();
}

/** From the summary to the send step, with a screenshot of each when `shots` is given. */
export async function summaryToSend(page: Page, shots?: string) {
  await next(page);
  await expect(page.getByRole('heading', { level: 2, name: 'הגדרות הסבב' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'תוקף הקישור (בימים)' })).toHaveValue(/\d+/);
  if (shots) await screen(page, `${shots}-5-settings`);
  await next(page);
  await expect(page.getByRole('heading', { level: 2, name: 'תצוגה מקדימה' })).toBeVisible();
  await expect(page.getByText(/^עמוד 1 מתוך/)).toBeVisible();
  await expect(page.getByTestId('email-subject')).toBeVisible();
  // The email really draws in its sandboxed frame, with the placeholder link only.
  const email = page.frameLocator('iframe[title="תצוגה מקדימה של המייל"]');
  await expect(email.getByText(/\/sign\/example-link/)).toBeVisible();
  if (shots) {
    await screen(page, `${shots}-6-preview`);
    await page
      .locator('iframe[title="תצוגה מקדימה של המייל"]')
      .screenshot({ path: `${SCREENS}/${shots}-6-email.png` });
  }
  await next(page);
  await expect(page.getByRole('heading', { level: 2, name: 'שליחה' })).toBeVisible();
  if (shots) await screen(page, `${shots}-7-send`);
}

/** "Send" → confirm; returns the create answer (its id goes into `roundIds` for afterAll). */
export async function sendAndConfirm(page: Page, roundIds: string[]) {
  const createdAnswer = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/rounds' && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'שליחה', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'לשלוח את הסבב?' });
  await dialog.getByRole('button', { name: 'שליחה', exact: true }).click();
  const response = await createdAnswer;
  if (response.status() === 201) roundIds.push(((await response.json()) as { id: string }).id);
  // Screens after this show the page, not the dialog fading out.
  await expect(dialog).toBeHidden();
  return response;
}
