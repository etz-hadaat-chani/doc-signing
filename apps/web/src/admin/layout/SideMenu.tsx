import type { UserRole } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import { Fragment } from 'react';
import { useLocation } from 'react-router';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';
import { activeMenuPath, type MenuGroup, menuFor } from '../navigation';
import { SideMenuItem } from './SideMenuItem';

const GROUPS: readonly MenuGroup[] = ['work', 'setup'];
const { layout, color } = tokens;

/** The right-hand menu: only the items of the user's role, in two groups. */
export function SideMenu({ role }: { role: UserRole }) {
  const { pathname } = useLocation();
  const items = menuFor(role);
  const active = activeMenuPath(pathname, items);
  const groups = GROUPS.map((group) => items.filter((item) => item.group === group)).filter(
    (groupItems) => groupItems.length > 0,
  );

  return (
    <Box
      component="nav"
      aria-label={he.nav.label}
      sx={{
        width: layout.sideMenuWidth,
        flexShrink: 0,
        position: 'sticky',
        top: layout.topBarHeight,
        height: `calc(100vh - ${layout.topBarHeight}px)`,
        overflowY: 'auto',
        bgcolor: color.surface,
        borderInlineEnd: `1px solid ${color.border}`,
        py: 2,
      }}
    >
      {groups.map((groupItems, index) => (
        <Fragment key={groupItems[0]?.group}>
          {index > 0 && <Divider sx={{ my: 1.5, mx: 2.5 }} />}
          <List disablePadding>
            {groupItems.map((item) => (
              <SideMenuItem key={item.path} item={item} active={item.path === active} />
            ))}
          </List>
        </Fragment>
      ))}
    </Box>
  );
}
