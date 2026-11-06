import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

export interface WebCspOptions {
  /** The Vite dev server: React's fast-refresh preamble is an inline script. */
  dev: boolean;
  /** Origin of the storage links (presigned images: answers panel, employer image), if any. */
  storageOrigin: string | null;
}

/**
 * The web pages' Content-Security-Policy (7.2). Nothing is loaded from another site, except the
 * images of our own storage links.
 * - script-src 'self': our own bundle only; the dev server adds 'unsafe-inline' for React's
 *   fast-refresh preamble (never in a build).
 * - style-src 'unsafe-inline': MUI / emotion add <style> tags, and the email preview (an
 *   `<iframe srcdoc>`, which inherits this policy) uses inline style attributes.
 * - img-src: data: and blob: for drawn and generated images; the storage origin for presigned links.
 * - worker-src 'self': the pdf.js worker is a file of our own build (no eval, no wasm).
 * - frame-src 'self': the hidden frame of the Excel export / ZIP; frame-ancestors 'none': no
 *   site, ours included, shows our pages in a frame.
 */
export function webCsp({ dev, storageOrigin }: WebCspOptions): string {
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', dev ? ["'self'", "'unsafe-inline'"] : ["'self'"]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', ...(storageOrigin ? [storageOrigin] : [])]],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'"]],
    ['worker-src', ["'self'"]],
    ['frame-src', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'self'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}

/** The origin of `S3_ENDPOINT` (e.g. MinIO `http://localhost:9000`), or null when unset / bad. */
export function storageOriginOf(endpoint: string | undefined): string | null {
  if (!endpoint) return null;
  try {
    return new URL(endpoint).origin;
  } catch {
    return null;
  }
}

type Next = (error?: unknown) => void;

/**
 * Headers on every page and file the web server sends. The API (`/api`, proxied) sets its own.
 * A page itself (HTML) is never kept (`no-store`): a shared office computer's back button and
 * cache keep nothing of `/kiosk` or `/sign`. Vite sets its own Cache-Control on the page just
 * before writing it, so that one header goes on at write time.
 */
export function securityHeadersMiddleware(csp: string) {
  return (request: IncomingMessage, response: ServerResponse, next: Next): void => {
    if (request.url?.startsWith('/api/') || request.url === '/api') {
      next();
      return;
    }
    response.setHeader('Content-Security-Policy', csp);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.headers.accept?.includes('text/html')) {
      const writeHead = response.writeHead.bind(response) as (...args: unknown[]) => ServerResponse;
      response.writeHead = (...args: unknown[]) => {
        response.setHeader('Cache-Control', 'no-store');
        return writeHead(...args);
      };
    }
    next();
  };
}

/** The headers above on the dev server and on `vite preview` (the built app). */
export function securityHeaders(storageOrigin: string | null): Plugin {
  return {
    name: 'doc-signing-security-headers',
    configureServer(server) {
      server.middlewares.use(securityHeadersMiddleware(webCsp({ dev: true, storageOrigin })));
    },
    configurePreviewServer(server) {
      server.middlewares.use(securityHeadersMiddleware(webCsp({ dev: false, storageOrigin })));
    },
  };
}
