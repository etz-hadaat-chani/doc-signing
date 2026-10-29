import { createTheme } from '@mui/material/styles';
import { theme } from './theme';
import { tokens } from './tokens';

const { sign } = tokens;

/**
 * The staff theme with the signing pages' larger text and controls (`tokens.sign`, PRD §3):
 * body, buttons and fields at 20 px, help and error lines at 18 px, controls 56 px high.
 */
export const signTheme = createTheme(theme, {
  typography: {
    h1: { fontSize: sign.titleSize },
    h2: { fontSize: sign.bodySize },
    body1: { fontSize: sign.bodySize },
    body2: { fontSize: sign.smallSize },
    button: { fontSize: sign.bodySize },
  },
  components: {
    MuiButton: {
      styleOverrides: { root: { minHeight: sign.controlMinHeight, paddingInline: 32 } },
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { minHeight: sign.controlMinHeight, fontSize: sign.bodySize } },
    },
    MuiInputLabel: {
      styleOverrides: { root: { fontSize: sign.bodySize } },
    },
    MuiFormHelperText: {
      styleOverrides: { root: { fontSize: sign.smallSize, marginInline: 0 } },
    },
    MuiAlert: {
      styleOverrides: { message: { fontSize: sign.bodySize } },
    },
  },
});
