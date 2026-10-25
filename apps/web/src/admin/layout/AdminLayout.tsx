import Box from '@mui/material/Box';
import { Outlet } from 'react-router';
import { OfflineBanner } from '../../components/feedback/OfflineBanner';
import { tokens } from '../../theme/tokens';
import { useAuthUser } from '../auth/session';
import { SideMenu } from './SideMenu';
import { TopBar } from './TopBar';

const { layout } = tokens;

/** The frame of every management screen: top bar, side menu, page area. */
export function AdminLayout() {
  const user = useAuthUser();
  return (
    <>
      <TopBar user={user} />
      <Box sx={{ display: 'flex', pt: `${layout.topBarHeight}px`, minHeight: '100vh' }}>
        <SideMenu role={user.role} />
        <Box component="main" sx={{ flex: 1, minWidth: 0 }}>
          <OfflineBanner />
          <Box sx={{ maxWidth: layout.contentMaxWidth, mx: 'auto', px: { xs: 2, md: 5 }, py: 5 }}>
            <Outlet />
          </Box>
        </Box>
      </Box>
    </>
  );
}
