import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

/** The seed users' password: SEED_USER_PASSWORD from the environment or the repo's .env. */
export function seedPassword(): string {
  if (process.env.SEED_USER_PASSWORD) return process.env.SEED_USER_PASSWORD;
  const env = readFileSync(new URL('../../../.env', import.meta.url), 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('SEED_USER_PASSWORD='));
  if (!line) throw new Error('Set SEED_USER_PASSWORD (as in .env) to run this test');
  return line.slice('SEED_USER_PASSWORD='.length).trim();
}

export async function logIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('אימייל').fill(email);
  await page.getByLabel('סיסמה').fill(password);
  await page.getByRole('button', { name: 'כניסה' }).click();
}
