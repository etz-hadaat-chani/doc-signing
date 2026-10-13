import { defineConfig } from 'vitest/config';

// Two projects: `unit` needs nothing; `db` runs against the test database (docsign_test),
// which global setup creates and migrates. DB test files are named *.db.spec.ts.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          exclude: ['**/*.db.spec.ts'],
        },
      },
      {
        test: {
          name: 'db',
          include: ['{src,test}/**/*.db.spec.ts'],
          globalSetup: ['test/setup/db-global-setup.ts'],
          setupFiles: ['test/setup/db-setup.ts'],
          // Files share one database; run them one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
