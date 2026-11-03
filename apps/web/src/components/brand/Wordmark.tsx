import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';

const { color, font, layout } = tokens;

/**
 * The organization's name as a wordmark: Heebo bold with a short accent rule under its start.
 * Used by the staff top bar, the login page and the signing pages (no admin imports here).
 * `onTopBar`: light colors for the dark top bar. `fontSize` defaults to the surrounding body text.
 */
export function Wordmark({
  onTopBar = false,
  center = false,
  fontSize,
}: {
  onTopBar?: boolean;
  center?: boolean;
  fontSize?: number;
}) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: center ? 'center' : 'flex-start',
        gap: 0.5,
      }}
    >
      <Typography
        component="span"
        sx={{
          fontSize,
          fontWeight: font.weight.bold,
          lineHeight: 1.2,
          color: onTopBar ? color.onTopBar : color.brand,
        }}
      >
        {he.app.organization}
      </Typography>
      <Box
        component="span"
        aria-hidden
        sx={{
          width: layout.wordmarkRuleWidth,
          height: layout.edgeWidth,
          bgcolor: onTopBar ? color.accentOnTopBar : color.accent,
        }}
      />
    </Box>
  );
}
