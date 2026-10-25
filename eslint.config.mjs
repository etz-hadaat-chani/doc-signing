// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const BROWSER_STORAGE = ['localStorage', 'sessionStorage', 'indexedDB'];
const NO_BROWSER_STORAGE =
  'Nothing is stored in the browser: the session is the httpOnly cookie, data comes from the API.';

export default defineConfig(
  globalIgnores([
    '**/dist/',
    '**/dist-worker/',
    '**/coverage/',
    '**/node_modules/',
    'apps/api/src/generated/',
  ]),

  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Plain JS config files are not part of any tsconfig.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['apps/api/**/*.ts', 'packages/shared/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },

  // The web app itself (not its e2e tests, which may inspect the browser).
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      // The staff session lives only in the API's httpOnly cookie: nothing is kept in the browser.
      'no-restricted-globals': [
        'error',
        ...BROWSER_STORAGE.map((name) => ({ name, message: NO_BROWSER_STORAGE })),
      ],
      'no-restricted-properties': [
        'error',
        ...['window', 'globalThis', 'self'].flatMap((object) =>
          BROWSER_STORAGE.map((property) => ({ object, property, message: NO_BROWSER_STORAGE })),
        ),
        { object: 'document', property: 'cookie', message: NO_BROWSER_STORAGE },
      ],
      // Text from the API is shown as text, never as HTML.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Show text as text; no HTML from strings.',
        },
      ],
    },
  },

  // Must stay last: turns off rules that conflict with Prettier.
  prettier,
);
