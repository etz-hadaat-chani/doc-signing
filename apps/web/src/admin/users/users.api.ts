import {
  type CreateUserInput,
  type PageQuery,
  pagedSchema,
  staffUserSchema,
  type UpdateUserInput,
} from '@doc-signing/shared';
import { staffRequest } from '../auth/staff-api';

/** Every staff-user query: invalidating `all` after a change refreshes every page. */
export const userKeys = {
  all: ['staff', 'users'] as const,
  list: (query: PageQuery) => ['staff', 'users', 'list', query] as const,
};

const userPageSchema = pagedSchema(staffUserSchema);

export function fetchUsers({ page, pageSize }: PageQuery, signal?: AbortSignal) {
  return staffRequest(`/api/users?page=${String(page)}&pageSize=${String(pageSize)}`, {
    schema: userPageSchema,
    signal,
  });
}

/** The password goes in the body only, never in an address. */
export function createUser(body: CreateUserInput) {
  return staffRequest('/api/users', { method: 'POST', body, schema: staffUserSchema });
}

/** Role, active, or a new password (body only). */
export function updateUser(id: string, body: UpdateUserInput) {
  return staffRequest(`/api/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    schema: staffUserSchema,
  });
}
