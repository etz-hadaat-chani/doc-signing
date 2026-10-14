import { z } from 'zod';

/**
 * `?page=&pageSize=` of every paged list. Query values arrive as strings, so they are coerced;
 * missing ones take the defaults. Failed checks report INVALID_VALUE.
 */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

/** An empty query value (`?dept=`) counts as not sent. */
export function optionalQuery<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

/** The body of every list response. */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** A schema for `Paged<item>`, e.g. to check a list response in the web app. */
export function pagedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
  });
}
