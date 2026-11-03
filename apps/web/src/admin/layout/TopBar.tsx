import type { AuthUser } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Wordmark } from '../../components/brand/Wordmark';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';
import { useLogout } from '../auth/session';

const { color, font, layout, focusRing } = tokens;

/** A thin line before an item, to set it apart from the one next to it. */
const separatedStart = {
  borderInlineStart: `1px solid ${color.onTopBarMuted}`,
  paddingInlineStart: 2,
};

/** A white ring: the brand-green one would not show on the dark bar. */
const focusOnTopBar = {
  outline: `${focusRing.width}px solid ${color.onTopBar}`,
  outlineOffset: focusRing.offset,
};

/** Thin dark-green bar: wordmark on the right; user, role and "יציאה" on the left. */
export function TopBar({ user }: { user: AuthUser }) {
  const logout = useLogout();
  const [leaving, setLeaving] = useState(false);

  const handleLogout = () => {
    setLeaving(true);
    void logout();
  };

  return (
    <Box
      component="header"
      sx={{
        position: 'fixed',
        insetInline: 0,
        top: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        height: layout.topBarHeight,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        px: 3,
        bgcolor: color.topBar,
        color: color.onTopBar,
      }}
    >
      <Wordmark onTopBar fontSize={font.size.section} />
      <Typography variant="body2" sx={{ ...separatedStart, color: color.onTopBarMuted }}>
        {he.app.systemName}
      </Typography>

      <Box sx={{ flex: 1 }} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography>{user.fullName}</Typography>
        <Typography variant="body2" sx={{ ...separatedStart, color: color.onTopBarMuted }}>
          {he.roles[user.role]}
        </Typography>
      </Box>
      <Button
        color="inherit"
        onClick={handleLogout}
        disabled={leaving}
        sx={{
          '&.Mui-focusVisible': focusOnTopBar,
          '&:hover': { bgcolor: color.brand },
          '&.Mui-disabled': { color: color.onTopBarMuted },
        }}
      >
        {he.topBar.logout}
      </Button>
    </Box>
  );
}
