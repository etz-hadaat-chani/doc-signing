import { defineConfig, devices } from '@playwright/test';

// End-to-end tests (task 7.1). Expects `pnpm dev` and the docker services to be running.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
