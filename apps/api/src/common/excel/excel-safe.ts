/**
 * The first characters that make Excel (or a CSV opened in it) read a cell as a formula: `=`,
 * `+`, `-`, `@`, and tab / carriage return, which some programs strip before reading the rest.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * A text cell that can't run as a formula (NFR-SEC-10): a leading `'` when it starts with one of
 * the characters above, so Excel shows it as plain text. Every text cell of an export goes
 * through this, also names and answers the employee typed.
 */
export function safeCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}
