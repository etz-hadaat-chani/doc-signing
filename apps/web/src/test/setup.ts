import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// findBy / waitFor wait up to 10 s (default 1 s): a lazy page can load slowly under the full
// suite. Still inside the 15 s testTimeout (vite.config.ts).
configure({ asyncUtilTimeout: 10_000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
