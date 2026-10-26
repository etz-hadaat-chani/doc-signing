import { importCommitResultSchema, importPreviewSchema } from '@doc-signing/shared';
import { staffRequest } from '../../auth/staff-api';

/**
 * Uploads the Har Gal export for the check report (multipart field `file`). The server keeps the
 * file and a preview batch; no employee or department changes.
 */
export function previewImport(file: File) {
  const form = new FormData();
  form.append('file', file);
  return staffRequest('/api/employees/import/preview', {
    method: 'POST',
    body: form,
    schema: importPreviewSchema,
  });
}

/** Applies the preview exactly as shown. No body: it also confirms the listed departments. */
export function commitImport(batchId: string) {
  return staffRequest(`/api/employees/import/${encodeURIComponent(batchId)}/commit`, {
    method: 'POST',
    schema: importCommitResultSchema,
  });
}
