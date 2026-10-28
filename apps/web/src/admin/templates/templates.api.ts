import {
  invitationPreviewSchema,
  pagedSchema,
  type TemplateItem,
  templateItemSchema,
  type TemplateListQuery,
  templatePreviewReportSchema,
  type TemplateUpdateInput,
} from '@doc-signing/shared';
import { staffRequest, staffRequestBytes } from '../auth/staff-api';

/** Every template query: invalidating `all` after a change refreshes the list, item and versions. */
export const templateKeys = {
  all: ['staff', 'templates'] as const,
  list: (query: TemplateListQuery) => ['staff', 'templates', 'list', query] as const,
  item: (id: string) => ['staff', 'templates', 'item', id] as const,
  versions: ['staff', 'templates', 'versions'] as const,
  active: ['staff', 'templates', 'active'] as const,
  /** No employee = the made-up sample. */
  check: (id: string, employeeId: string | null = null) =>
    ['staff', 'templates', 'check', id, employeeId] as const,
  previewPdf: (id: string, employeeId: string | null = null) =>
    ['staff', 'templates', 'preview-pdf', id, employeeId] as const,
  invitationPreview: (id: string, linkExpiryDays: number) =>
    ['staff', 'templates', 'invitation-preview', id, linkExpiryDays] as const,
};

const templatePageSchema = pagedSchema(templateItemSchema);
/** The API's largest page (pageQuerySchema). */
const MAX_PAGE_SIZE = 100;

/** Filters and paging as a query string; values not set (and `includeArchived=false`) left out. */
function toQueryString(query: TemplateListQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.dept !== undefined) params.set('dept', query.dept);
  if (query.includeArchived) params.set('includeArchived', 'true');
  return params.toString();
}

export function fetchTemplates(query: TemplateListQuery, signal?: AbortSignal) {
  return staffRequest(`/api/templates?${toQueryString(query)}`, {
    schema: templatePageSchema,
    signal,
  });
}

/** Every page of the list (templates are few, tens). */
async function fetchAllTemplates(
  includeArchived: boolean,
  signal?: AbortSignal,
): Promise<TemplateItem[]> {
  const items: TemplateItem[] = [];
  for (let page = 1; ; page += 1) {
    const answer = await fetchTemplates({ page, pageSize: MAX_PAGE_SIZE, includeArchived }, signal);
    items.push(...answer.items);
    if (answer.items.length === 0 || items.length >= answer.total) return items;
  }
}

/**
 * Every template version, archived and old ones too, for the version history: the API has no
 * route per template, so all pages are read.
 */
export function fetchAllTemplateVersions(signal?: AbortSignal): Promise<TemplateItem[]> {
  return fetchAllTemplates(true, signal);
}

/** Every active template (not archived, latest version), for choosing a round's document. */
export function fetchActiveTemplates(signal?: AbortSignal): Promise<TemplateItem[]> {
  return fetchAllTemplates(false, signal);
}

/** Any version, also archived or old ones. */
export function fetchTemplate(id: string, signal?: AbortSignal) {
  return staffRequest(`/api/templates/${encodeURIComponent(id)}`, {
    schema: templateItemSchema,
    signal,
  });
}

export interface TemplateUpload {
  file: File;
  name: string;
  departmentIds: readonly string[];
}

/** Version 1 with no positions (multipart: `file`, `name`, `departmentIds` repeated). */
export function uploadTemplate({ file, name, departmentIds }: TemplateUpload) {
  const form = new FormData();
  form.append('name', name);
  for (const id of departmentIds) form.append('departmentIds', id);
  form.append('file', file);
  return staffRequest('/api/templates', {
    method: 'POST',
    body: form,
    schema: templateItemSchema,
  });
}

/** A locked template answers with its new version when the document changed (FR-TPL-4). */
export function updateTemplate(id: string, input: TemplateUpdateInput) {
  return staffRequest(`/api/templates/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
    schema: templateItemSchema,
  });
}

export function archiveTemplate(id: string) {
  return staffRequest(`/api/templates/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
    schema: templateItemSchema,
  });
}

/** `?employeeId=` (an id, never personal data); none = the made-up sample employee. */
const employeeQuery = (employeeId: string | null) =>
  employeeId === null ? '' : `?${new URLSearchParams({ employeeId }).toString()}`;

/** What the preview found: missing values, boxes left for the employee, warnings. */
export function fetchPreviewCheck(
  id: string,
  signal?: AbortSignal,
  employeeId: string | null = null,
) {
  return staffRequest(
    `/api/templates/${encodeURIComponent(id)}/preview/check${employeeQuery(employeeId)}`,
    { schema: templatePreviewReportSchema, signal },
  );
}

/**
 * The sample preview PDF, opened in a new tab: the API forbids showing its answers in a frame
 * (X-Frame-Options), and it is never cached.
 */
export function previewPath(id: string, employeeId: string | null = null): `/api/${string}` {
  return `/api/templates/${encodeURIComponent(id)}/preview${employeeQuery(employeeId)}`;
}

/**
 * The same preview as bytes, for pdf.js: the position editor (5.4 part B; the API draws the saved
 * positions only, the editor outlines the unsaved ones on top) and the round wizard's preview.
 */
export function fetchPreviewPdf(
  id: string,
  signal?: AbortSignal,
  employeeId: string | null = null,
): Promise<ArrayBuffer> {
  return staffRequestBytes(previewPath(id, employeeId), { signal });
}

/** The invitation as if sent now (Flow 3 step 6); nothing is sent or stored. */
export function fetchInvitationPreview(id: string, linkExpiryDays: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ linkExpiryDays: String(linkExpiryDays) }).toString();
  return staffRequest(`/api/templates/${encodeURIComponent(id)}/invitation-preview?${query}`, {
    schema: invitationPreviewSchema,
    signal,
  });
}
