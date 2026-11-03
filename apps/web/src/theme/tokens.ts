/**
 * Every design value of the web app. Screens use these (or the MUI theme built from them in
 * theme.ts), never their own colors, sizes or shadows. Contrast pairs are checked in
 * tokens.spec.ts (WCAG AA).
 */
export const tokens = {
  color: {
    /** Page background: a slightly warm paper tone behind the white surfaces. */
    background: '#F7F4F0',
    surface: '#FFFFFF',
    text: '#1F2328',
    textSecondary: '#5F6368',
    border: '#E3E3DE',
    /** Border of outlined buttons: a little stronger than `border`, so they read as buttons. */
    borderStrong: '#C4C4BD',
    /** The brand color: primary button, active menu item text, links, focus ring. */
    brand: '#2F5D50',
    brandHover: '#264C41',
    /** Very light brand tint: hover and active backgrounds of menu items. */
    brandTint: '#EEF3F1',
    /**
     * The one warm accent (TASKS 4.3): lines and edges only, never text (4.45:1 on white). Tile
     * edges, the bar before a page title, the active menu item's bar, the wordmark rule.
     */
    accent: '#B4613C',
    /** Background of empty states and the login card's top band. */
    accentTint: '#F7EDE6',
    /** Text on `accentTint`. */
    accentText: '#8A4A22',
    /** The staff top bar: a deeper green than `brand`, so the brand button stays distinct. */
    topBar: '#1E3F36',
    /** On the top bar: main text, the quieter second line, the accent and the focus ring. */
    onTopBar: '#FFFFFF',
    onTopBarMuted: '#D5E3DD',
    accentOnTopBar: '#E6CFA0',
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
    /** Sizes in px: page title, section, body, small; `stat` = the big number of a dashboard tile. */
    size: { title: 24, section: 18, body: 16, small: 14, stat: 32 },
    /** `bold`: page titles and the big tile numbers only. */
    weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
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
    /** The colored start-side edge of a dashboard tile and the bar before a page title. */
    edgeWidth: 3,
    /** The wordmark's short accent rule. */
    wordmarkRuleWidth: 20,
  },
  control: { minHeight: 40, largeMinHeight: 44 },
  /**
   * The employee signing pages (phase 6, PRD §3): larger text and controls for a wide range of
   * computer skills. Sizes in px; colors are the ones above.
   */
  sign: {
    titleSize: 28,
    bodySize: 20,
    smallSize: 18,
    controlMinHeight: 56,
    contentMaxWidth: 640,
    /** B2: the document is read on a wider card (an A4 page about 880 px wide at 1280 px). */
    documentMaxWidth: 960,
  },
  /** `insetOffset` draws the ring inside, where an outer ring would be clipped (side menu). */
  focusRing: { width: 2, offset: 2, insetOffset: -2 },
} as const;
