import { Outlet } from 'react-router';
import { NotificationProvider } from '../components/notifications/NotificationProvider';
import { useStaffAccessEvents } from './auth/session';

/**
 * Top of the staff area: listens for 401 / 403 from any staff request (see session.ts) and
 * shows notifications (useNotify) for every screen.
 */
export function StaffRoot() {
  useStaffAccessEvents();
  return (
    <NotificationProvider>
      <Outlet />
    </NotificationProvider>
  );
}
