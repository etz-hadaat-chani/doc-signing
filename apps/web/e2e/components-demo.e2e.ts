import { expect, test } from '@playwright/test';
import { logIn, seedPassword } from './helpers';

// Task 4.2: the components demo page (exists only in `pnpm dev`), manager only.

test('manager opens the components demo, right to left', async ({ page }) => {
  await logIn(page, 'manager@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();

  await page.goto('/demo/components');
  await expect(
    page.getByRole('heading', { level: 1, name: 'רכיבים משותפים (הדגמה)' }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('נחתם, ממתין לאישור').first()).toBeVisible();
  const table = page.getByRole('table', { name: 'עובדים לדוגמה' });
  await expect(table.getByRole('row')).toHaveCount(26);

  // Filters go in the address; the search text never does.
  await page.getByRole('searchbox', { name: 'חיפוש' }).fill('D-0007');
  await page.keyboard.press('Enter');
  await expect(table.getByRole('row')).toHaveCount(2);
  expect(page.url()).not.toContain('D-0007');
});

test('officer sees "no permission" on the components demo', async ({ page }) => {
  await logIn(page, 'officer@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();

  await page.goto('/demo/components');
  await expect(page.getByRole('heading', { level: 1, name: 'אין לך הרשאה' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});
