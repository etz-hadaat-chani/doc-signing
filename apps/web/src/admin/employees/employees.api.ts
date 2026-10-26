import {
  type CreateEmployeeInput,
  departmentSchema,
  employeeCardSchema,
  employeeHistoryItemSchema,
  employeeListItemSchema,
  type employeeListQuerySchema,
  type EmployeeListQuery,
  pagedSchema,
  type UpdateEmployeeInput,
} from '@doc-signing/shared';
import { z } from 'zod';
import { staffRequest } from '../auth/staff-api';

export type EmployeeFilters = z.output<typeof employeeListQuerySchema>;

/** Every employee query: invalidating `all` after a save refreshes the list, card and history. */
export const employeeKeys = {
  all: ['staff', 'employees'] as const,
  list: (query: EmployeeListQuery) => ['staff', 'employees', 'list', query] as const,
  card: (id: string) => ['staff', 'employees', 'card', id] as const,
  history: (id: string, page: number, pageSize: number) =>
    ['staff', 'employees', 'history', id, page, pageSize] as const,
  departments: ['staff', 'departments'] as const,
};

const employeePageSchema = pagedSchema(employeeListItemSchema);

/** Filters and paging as a query string (`active=false`); values not set are left out. */
function toQueryString(filters: EmployeeListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.toString();
}

/**
 * One page of the list. With search text it is the POST search (the text may be an ID number, so
 * it never goes in a URL); without it, the GET with filters only.
 */
export function fetchEmployees(query: EmployeeListQuery, signal?: AbortSignal) {
  if (query.q !== undefined) {
    return staffRequest('/api/employees/search', {
      method: 'POST',
      body: query,
      schema: employeePageSchema,
      signal,
    });
  }
  return staffRequest(`/api/employees?${toQueryString(query)}`, {
    schema: employeePageSchema,
    signal,
  });
}

export function fetchEmployee(id: string, signal?: AbortSignal) {
  return staffRequest(`/api/employees/${encodeURIComponent(id)}`, {
    schema: employeeCardSchema,
    signal,
  });
}

/** The employee's rounds, newest first (FR-TRK-5). */
export function fetchEmployeeHistory(
  id: string,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return staffRequest(`/api/employees/${encodeURIComponent(id)}/assignments?${query.toString()}`, {
    schema: pagedSchema(employeeHistoryItemSchema),
    signal,
  });
}

/** Every department, sorted by code by the API (a short list: no paging). */
export function fetchDepartments(signal?: AbortSignal) {
  return staffRequest('/api/departments', {
    schema: z.object({ items: z.array(departmentSchema) }),
    signal,
  }).then(({ items }) => items);
}

export function createEmployee(input: CreateEmployeeInput) {
  return staffRequest('/api/employees', {
    method: 'POST',
    body: input,
    schema: employeeCardSchema,
  });
}

export function updateEmployee(id: string, input: UpdateEmployeeInput) {
  return staffRequest(`/api/employees/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
    schema: employeeCardSchema,
  });
}

/** The signed PDF: the API checks the role, logs the view and redirects to a short-lived link. */
export function documentPath(assignmentId: string): string {
  return `/api/assignments/${encodeURIComponent(assignmentId)}/document`;
}
