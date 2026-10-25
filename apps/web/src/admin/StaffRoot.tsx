import { Outlet } from 'react-router';
import { useStaffAccessEvents } from './auth/session';

/** Top of the staff area: listens for 401 / 403 from any staff request (see session.ts). */
export function StaffRoot() {
  useStaffAccessEvents();
  return <Outlet />;
}
