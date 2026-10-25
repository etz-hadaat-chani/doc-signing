import { isApiRequestError } from '../../api/api-error';
import { he } from '../../i18n/he';

export type ErrorVariant = 'forbidden' | 'notFound' | 'server' | 'network' | 'crash';

export interface ErrorContent {
  variant: ErrorVariant;
  title: string;
  message: string;
  referenceId?: string;
}

/** What to show for a failed request or a crash: title, Hebrew text, and the icon variant. */
export function errorContent(error: unknown): ErrorContent {
  if (!isApiRequestError(error)) {
    return { variant: 'crash', title: he.feedback.crashTitle, message: he.feedback.crashText };
  }
  if (error.kind === 'network') {
    return { variant: 'network', title: he.feedback.networkTitle, message: error.message };
  }
  if (error.status === 403) {
    return {
      variant: 'forbidden',
      title: he.feedback.noPermissionTitle,
      message: he.feedback.noPermissionText,
    };
  }
  if (error.status === 404) {
    return { variant: 'notFound', title: he.feedback.notFoundTitle, message: error.message };
  }
  return {
    variant: 'server',
    title: he.feedback.serverErrorTitle,
    message: error.message,
    ...(error.referenceId && { referenceId: error.referenceId }),
  };
}
