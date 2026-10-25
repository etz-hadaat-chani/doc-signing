import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { z } from 'zod';

type QueryValue = string | number | boolean | readonly (string | number)[] | undefined;
type AnyQuerySchema = z.ZodObject<Record<string, z.ZodType<QueryValue>>>;

/**
 * Search text never goes in the address (it may be an ID number): a schema with a `q` key is a
 * type error here. Keep it in memory (SearchField) and send it in a POST body.
 */
type WithoutSearch<S extends AnyQuerySchema> = 'q' extends keyof z.output<S> ? never : S;

/**
 * A table's page, page size and filters, kept in the address (`?status=sent&page=2`), so a link
 * or a reload keeps them. Only non-personal values: status, department, page. Read back with a
 * shared schema (e.g. `pageQuerySchema.extend({ ... })`); a value the schema refuses is dropped
 * and that key takes its default, so a broken address never breaks the page.
 */
export function useTableQuery<S extends AnyQuerySchema>(schema: WithoutSearch<S>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = useMemo(() => schema.parse({}), [schema]);
  const search = searchParams.toString();

  const query = useMemo(() => parseQuery(schema, new URLSearchParams(search)), [schema, search]);

  /** Changes some values; any change other than the page goes back to page 1. */
  const setQuery = useCallback(
    (patch: Partial<z.output<S>>) => {
      const next: Record<string, unknown> = { ...query, ...patch };
      if (!('page' in patch)) next.page = 1;
      setSearchParams(toSearchParams(next, defaults));
    },
    [query, defaults, setSearchParams],
  );

  return { query, setQuery };
}

function parseQuery<S extends AnyQuerySchema>(schema: S, params: URLSearchParams): z.output<S> {
  const raw: Record<string, string | string[]> = {};
  for (const key of Object.keys(schema.shape)) {
    const values = params.getAll(key);
    if (values.length === 1) raw[key] = values[0] ?? '';
    else if (values.length > 1) raw[key] = values;
  }
  // Drop each refused key and try again; at most once per key.
  for (let attempt = 0; attempt <= Object.keys(raw).length; attempt += 1) {
    const result = schema.safeParse(raw);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string') delete raw[key];
    }
  }
  return schema.parse({});
}

function toSearchParams(values: Record<string, unknown>, defaults: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === defaults[key]) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  return params;
}
