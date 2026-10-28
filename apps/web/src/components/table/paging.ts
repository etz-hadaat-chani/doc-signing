import { type Paged, pageQuerySchema } from '@doc-signing/shared';

/** Page sizes to choose from; every one is within the API's limit (pageQuerySchema, max 100). */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
/** The API's default page size (25). */
export const DEFAULT_PAGE_SIZE = pageQuerySchema.parse({}).pageSize;

/** One page of a list kept in memory, in the API's list shape (for DataTable). */
export function pageOf<T>(items: readonly T[], page: number, pageSize: number): Paged<T> {
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}
