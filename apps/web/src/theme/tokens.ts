/**
 * Every design value of the web app. Screens use these (or the MUI theme built from them in
 * theme.ts), never their own colors, sizes or shadows. Contrast pairs are checked in
 * tokens.spec.ts (WCAG AA).
 */
export const tokens = {
  color: {
    background: '#F7F7F5',
    surface: '#FFFFFF',
    text: '#1F2328',
    textSecondary: '#5F6368',
    border: '#E3E3DE',
    /** Border of outlined buttons: a little stronger than `border`, so they read as buttons. */
    borderStrong: '#C4C4BD',
    /** The one brand color: primary button, active menu item, links, focus ring. */
    brand: '#2F5D50',
    brandHover: '#264C41',
    /** Very light brand tint for hover backgrounds of menu items. */
    brandTint: '#EEF3F1',
    error: '#B3261E',
    errorTint: '#FBEFEE',
    warning: '#8A5A00',
    warningTint: '#FDF5E6',
    /** Status chips (components/status): done / in progress / neutral, each text on its tint. */
    success: '#1E6B3A',
    successTint: '#EAF4EE',
    info: '#1D4F91',
    infoTint: '#EDF3FB',
    /** Background of neutral chips (text: textSecondary). */
    neutralTint: '#F1F1EE',
  },
  font: {
    family: "'Heebo Variable', 'Heebo', Arial, sans-serif",
    /** Sizes in px: page title, section, body, small. */
    size: { title: 24, section: 18, body: 16, small: 14 },
    weight: { regular: 400, medium: 500, semibold: 600 },
  },
  /** Base unit of the 8 px grid (MUI `spacing(1)`). */
  spacing: 8,
  radius: { control: 6, table: 2 },
  /** The only shadow: dialogs, menus and popovers. */
  shadow: { overlay: '0 4px 16px rgba(31, 35, 40, 0.12)' },
  layout: {
    sideMenuWidth: 248,
    topBarHeight: 56,
    contentMaxWidth: 1200,
    activeBarWidth: 3,
  },
  control: { minHeight: 40, largeMinHeight: 44 },
  /** `insetOffset` draws the ring inside, where an outer ring would be clipped (side menu). */
  focusRing: { width: 2, offset: 2, insetOffset: -2 },
} as const;
