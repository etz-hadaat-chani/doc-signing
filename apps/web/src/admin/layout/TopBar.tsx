import type { AuthUser } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';
import { useLogout } from '../auth/session';

const { color, font, layout } = tokens;

/** A thin line before an item, to set it apart from the one next to it. */
const separatedStart = { borderInlineStart: `1px solid ${color.border}`, paddingInlineStart: 2 };

/** Thin white bar: organization on the right; user, role and "יציאה" on the left. */
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
        bgcolor: color.surface,
        borderBottom: `1px solid ${color.border}`,
      }}
    >
      <Typography sx={{ fontSize: font.size.section, fontWeight: font.weight.semibold }}>
        {he.app.organization}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={separatedStart}>
        {he.app.systemName}
      </Typography>

      <Box sx={{ flex: 1 }} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography>{user.fullName}</Typography>
        <Typography variant="body2" color="text.secondary" sx={separatedStart}>
          {he.roles[user.role]}
        </Typography>
      </Box>
      <Button color="inherit" onClick={handleLogout} disabled={leaving}>
        {he.topBar.logout}
      </Button>
    </Box>
  );
}
