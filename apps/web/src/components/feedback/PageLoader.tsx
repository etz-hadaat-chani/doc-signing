import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { he } from '../../i18n/he';

/** Shown after a short delay, so a fast answer doesn't make the screen flicker. */
const SHOW_AFTER_MS = 300;

/** The one "loading" look of the app. */
export function PageLoader() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 10 }}
    >
      {visible && (
        <>
          <CircularProgress size={32} thickness={4} />
          <Typography color="text.secondary">{he.feedback.loading}</Typography>
        </>
      )}
    </Box>
  );
}
