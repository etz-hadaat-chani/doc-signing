import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { RtlCacheProvider } from '../theme/RtlCacheProvider';
import { theme } from '../theme/theme';

/** Look and direction, shared by both app areas (staff and signing). */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <RtlCacheProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </RtlCacheProvider>
  );
}
