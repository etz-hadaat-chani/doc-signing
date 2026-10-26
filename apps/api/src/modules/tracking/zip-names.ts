/** Longest folder or file name part (in characters) the ZIP and download names use. */
export const NAME_PART_MAX = 100;

/**
 * One folder or file name that Windows accepts: control characters and `< > : " / \ | ? *`
 * become `_`, trailing dots and spaces go (Explorer drops them), cut to `max` characters (whole
 * code points, never half a Hebrew letter); an empty result is `_`.
 */
export function windowsSafeName(value: string, max = NAME_PART_MAX): string {
  // eslint-disable-next-line no-control-regex
  const replaced = value.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_');
  const cut = [...replaced].slice(0, max).join('');
  return cut.replace(/[. ]+$/, '').trim() || '_';
}

/**
 * Makes ZIP entry paths unique the way Windows compares them (any case): the second
 * `a/b.pdf` becomes `a/b (2).pdf`, then `(3)` and so on.
 */
export class UniqueNames {
  private readonly used = new Set<string>();

  take(path: string): string {
    const dot = path.lastIndexOf('.');
    const slash = path.lastIndexOf('/');
    const [stem, extension] = dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ''];
    let candidate = path;
    for (let n = 2; this.used.has(candidate.toLowerCase()); n += 1) {
      candidate = `${stem} (${n})${extension}`;
    }
    this.used.add(candidate.toLowerCase());
    return candidate;
  }
}
