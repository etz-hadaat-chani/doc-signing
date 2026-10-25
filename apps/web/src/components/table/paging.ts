import { pageQuerySchema } from '@doc-signing/shared';

/** Page sizes to choose from; every one is within the API's limit (pageQuerySchema, max 100). */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
/** The API's default page size (25). */
export const DEFAULT_PAGE_SIZE = pageQuerySchema.parse({}).pageSize;
