/**
 * Loads `path` as a fresh page in place of this one (`location.replace`): the old page and
 * everything in its memory are gone, and "Back" can't return to it. A module of its own so the
 * jsdom tests can watch it (jsdom can't navigate).
 */
export function replacePage(path: string): void {
  window.location.replace(path);
}
