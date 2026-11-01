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
      styleOverrides: {
        root: { minHeight: sign.controlMinHeight, fontSize: sign.bodySize },
        // The gap in the border fits the raised label below.
        notchedOutline: { '& legend': { fontSize: sign.smallSize } },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: sign.bodySize,
          // A raised label is drawn at 75%: at least 18 px on screen.
          '&.MuiInputLabel-shrink': {
            fontSize: sign.smallSize / 0.75,
            transform: 'translate(14px, -13px) scale(0.75)',
          },
        },
      },
    },
    MuiFormHelperText: {
      styleOverrides: { root: { fontSize: sign.smallSize, marginInline: 0 } },
    },
    MuiAlert: {
      styleOverrides: { message: { fontSize: sign.bodySize } },
    },
    // A dialog on a signing page (the office computer's email confirm): the same large text.
    MuiDialogTitle: {
      styleOverrides: {
        root: { fontSize: sign.bodySize, fontWeight: tokens.font.weight.semibold },
      },
    },
  },
});
