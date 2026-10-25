import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import type { ReactNode } from 'react';
import rtlPlugin from 'stylis-plugin-rtl';

// Flips every left/right style (margins, padding, borders, positions) for right-to-left.
// No vendor prefixer: the supported browsers (current Chrome, Edge, Firefox) don't need one.
const rtlCache = createCache({ key: 'muirtl', stylisPlugins: [rtlPlugin] });

export function RtlCacheProvider({ children }: { children: ReactNode }) {
  return <CacheProvider value={rtlCache}>{children}</CacheProvider>;
}
