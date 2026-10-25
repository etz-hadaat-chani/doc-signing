import { type ErrorCode, errorMessage } from '@doc-signing/shared';
import { he } from '../i18n/he';

/**
 * - `api`: an error in our format (`{ error: { code, message } }`).
 * - `network`: no answer at all (offline, server down).
 * - `unexpected`: an answer that isn't ours or doesn't match the expected shape (e.g. a filter's
 *   block page, a proxy's HTML error).
 */
export type ApiErrorKind = 'api' | 'network' | 'unexpected';

interface ApiRequestErrorInit {
  kind: ApiErrorKind;
  status?: number;
  code?: ErrorCode;
  details?: Record<string, unknown>;
  retryAfterSeconds?: number;
}

/** Every failed API call ends in this error. `message` is Hebrew text, safe to show as text. */
export class ApiRequestError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: ErrorCode | null;
  readonly details: Record<string, unknown> | undefined;
  readonly retryAfterSeconds: number | null;

  constructor(init: ApiRequestErrorInit) {
    super(messageFor(init));
    this.name = 'ApiRequestError';
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.details = init.details;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }

  /** The API's reference for a server error (500), to quote to support. */
  get referenceId(): string | null {
    const id = this.details?.referenceId;
    return typeof id === 'string' ? id : null;
  }
}

/** Our own Hebrew text by code, never text taken from a response that isn't ours. */
function messageFor(init: ApiRequestErrorInit): string {
  if (init.kind === 'network') return he.feedback.networkText;
  if (init.kind === 'api' && init.code) return errorMessage(init.code);
  return he.feedback.unexpectedText;
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}
