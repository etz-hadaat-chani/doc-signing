import { defineConfig } from 'vitest/config';

// Two projects: `unit` needs nothing; `db` needs the docker services: the test database
// (docsign_test, created and migrated by global setup), the MinIO test bucket (documents-test)
// and Mailpit (the email tests).
// These test files are named *.db.spec.ts.
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
