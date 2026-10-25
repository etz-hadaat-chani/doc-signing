import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { he } from '../i18n/he';
import { tokens } from '../theme/tokens';

/** `/sign/:token` until phase 6 builds the signing screens. */
export function SignPlaceholderPage() {
  return (
    <Box component="main" sx={{ maxWidth: tokens.layout.contentMaxWidth, mx: 'auto', p: 4 }}>
      <Typography variant="h1" sx={{ mb: 2 }}>
        {he.sign.placeholderTitle}
      </Typography>
      <Typography color="text.secondary">{he.sign.placeholderText}</Typography>
    </Box>
  );
}
