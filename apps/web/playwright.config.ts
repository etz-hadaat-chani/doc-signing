import { defineConfig, devices } from '@playwright/test';

const ci = Boolean(process.env.CI);

// End-to-end tests (task 7.1). Expects `pnpm dev` and the docker services to be running
// (in GitHub CI: the `e2e` job starts the api, the worker and vite itself).
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  // Fails the run if a test template is still active (5.4 danger rule).
  globalTeardown: './e2e/global-teardown.ts',
  forbidOnly: ci,
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    // CI only: kept for the failure artifact (fake data only). Local runs keep none.
    trace: ci ? 'retain-on-failure' : 'off',
    screenshot: ci ? 'only-on-failure' : 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
