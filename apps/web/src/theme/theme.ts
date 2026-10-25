import { createTheme, type Shadows } from '@mui/material/styles';
import { tokens } from './tokens';

const { color, font, radius, shadow, control, focusRing } = tokens;

const focusOutline = {
  outline: `${focusRing.width}px solid ${color.brand}`,
  outlineOffset: focusRing.offset,
};

/** Borders separate things, not shadows: every elevation is flat. */
const flatShadows = Array<string>(25).fill('none') as Shadows;

export const theme = createTheme({
  direction: 'rtl',
  spacing: tokens.spacing,
  shape: { borderRadius: radius.control },
  shadows: flatShadows,
  palette: {
    mode: 'light',
    primary: { main: color.brand, dark: color.brandHover, contrastText: color.surface },
    error: { main: color.error },
    warning: { main: color.warning },
    background: { default: color.background, paper: color.surface },
    text: { primary: color.text, secondary: color.textSecondary },
    divider: color.border,
    // Background of a keyboard-focused list or menu item (MUI's default is a grey).
    action: { focus: color.brandTint },
  },
  typography: {
    fontFamily: font.family,
    fontSize: font.size.small,
    htmlFontSize: 16,
    h1: { fontSize: font.size.title, fontWeight: font.weight.semibold, lineHeight: 1.35 },
    h2: { fontSize: font.size.section, fontWeight: font.weight.semibold, lineHeight: 1.4 },
    h3: { fontSize: font.size.body, fontWeight: font.weight.semibold, lineHeight: 1.5 },
    h4: { fontSize: font.size.body, fontWeight: font.weight.semibold, lineHeight: 1.5 },
    h5: { fontSize: font.size.body, fontWeight: font.weight.semibold, lineHeight: 1.5 },
    h6: { fontSize: font.size.body, fontWeight: font.weight.semibold, lineHeight: 1.5 },
    subtitle1: { fontSize: font.size.body, lineHeight: 1.5 },
    subtitle2: { fontSize: font.size.small, fontWeight: font.weight.medium, lineHeight: 1.5 },
    body1: { fontSize: font.size.body, lineHeight: 1.6 },
    body2: { fontSize: font.size.small, lineHeight: 1.55 },
    caption: { fontSize: font.size.small, lineHeight: 1.5 },
    button: {
      fontSize: font.size.body,
      fontWeight: font.weight.medium,
      textTransform: 'none',
      letterSpacing: 0,
    },
    overline: { fontSize: font.size.small, textTransform: 'none', letterSpacing: 0 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: color.background, color: color.text },
        // A clear keyboard focus ring on everything focusable.
        '*:focus-visible': focusOutline,
        a: { color: color.brand },
      },
    },
    MuiButtonBase: {
      defaultProps: { disableRipple: true },
      styleOverrides: { root: { '&.Mui-focusVisible': focusOutline } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: control.minHeight,
          paddingInline: 20,
          variants: [
            {
              // Brand green is for the one primary (filled) button; outlined ones stay neutral.
              props: { variant: 'outlined', color: 'primary' },
              style: {
                color: color.text,
                borderColor: color.borderStrong,
                '&:hover': { borderColor: color.textSecondary, backgroundColor: color.background },
              },
            },
          ],
        },
        sizeLarge: { minHeight: control.largeMinHeight },
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { minWidth: control.minHeight, minHeight: control.minHeight } },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { outlined: { borderColor: color.border } },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: { backgroundColor: color.surface, borderBottom: `1px solid ${color.border}` },
      },
    },
    MuiDialog: {
      styleOverrides: { paper: { boxShadow: shadow.overlay } },
    },
    MuiPopover: {
      styleOverrides: { paper: { boxShadow: shadow.overlay, border: `1px solid ${color.border}` } },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { minHeight: control.minHeight, backgroundColor: color.surface },
        // The focused input already shows a 2 px brand border; no second outline inside it.
        input: { '&:focus-visible': { outline: 'none' } },
      },
    },
    MuiTableCell: {
      styleOverrides: { root: { borderColor: color.border } },
    },
    MuiLink: {
      defaultProps: { color: 'primary', underline: 'hover' },
    },
    MuiAlert: {
      defaultProps: { variant: 'outlined' },
    },
  },
});
