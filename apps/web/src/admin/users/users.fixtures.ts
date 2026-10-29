import type { StaffUser } from '@doc-signing/shared';
import { managerUser } from '../../test/render';

/** Made-up staff users as `GET /api/users` returns them; the first is the signed-in manager. */
export const STAFF: StaffUser[] = [
  {
    id: managerUser.id,
    email: managerUser.email,
    fullName: managerUser.fullName,
    role: 'manager',
    isActive: true,
    lastLoginAt: '2026-10-28T06:15:00.000Z',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: '9c1d2e3f-4a5b-4c6d-8e7f-001122334455',
    email: 'second.manager@example.test',
    fullName: 'מנהל שני לדוגמה',
    role: 'manager',
    isActive: true,
    lastLoginAt: null,
    createdAt: '2026-02-01T08:00:00.000Z',
  },
  {
    id: 'ad2e3f40-5b6c-4d7e-9f80-112233445566',
    email: 'officer.sample@example.test',
    fullName: 'קצין לדוגמה',
    role: 'officer',
    isActive: false,
    lastLoginAt: '2026-09-01T12:30:00.000Z',
    createdAt: '2026-03-01T08:00:00.000Z',
  },
];

export const usersPage = (items: StaffUser[] = STAFF) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
});
