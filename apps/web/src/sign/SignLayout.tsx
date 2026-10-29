import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import { ThemeProvider } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { he } from '../i18n/he';
import { signTheme } from '../theme/sign-theme';
import { tokens } from '../theme/tokens';

/**
 * The frame of every employee page (B1–B5, the office computer): the organization's name and
 * one calm white card, no staff header or menu. Larger text through `signTheme`. `wide`: the
 * document screen (B2), where the pages need the room.
 */
export function SignLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <ThemeProvider theme={signTheme}>
      <Box
        component="main"
        sx={{
          maxWidth: wide ? tokens.sign.documentMaxWidth : tokens.sign.contentMaxWidth,
          mx: 'auto',
          px: 2,
          py: { xs: 3, sm: 6 },
        }}
      >
        <Box sx={{ mb: 3, textAlign: 'center' }}>
          <Typography sx={{ fontWeight: tokens.font.weight.semibold, color: 'primary.main' }}>
            {he.app.organization}
          </Typography>
          <Typography color="text.secondary">{he.sign.areaName}</Typography>
        </Box>
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 5 } }}>
          {children}
        </Paper>
      </Box>
    </ThemeProvider>
  );
}
