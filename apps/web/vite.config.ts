import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { securityHeaders, storageOriginOf } from './vite/security-headers.ts';

// The repo-root .env (shared with the API); variables already set in the environment win.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // CSP and the other page headers (7.2); the storage host is allowed for presigned images.
    securityHeaders(storageOriginOf(loadEnv(mode, repoRoot, 'S3_').S3_ENDPOINT)),
  ],
  resolve: {
    alias: {
      // Use the shared package's TypeScript source directly, so changes hot-reload without a build.
      '@doc-signing/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.{ts,tsx}', 'vite/**/*.spec.ts'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    // 15 s, not the 5 s default: UI tests that type or load a lazy page take 0.4–1.4 s alone but
    // went over 5 s when every suite runs at once (staff-routes login, filters department).
    testTimeout: 15_000,
  },
}));
