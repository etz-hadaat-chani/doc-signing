/**
 * Numbers as screens show them ("1,500"). Dates and times come from @doc-signing/shared
 * (`formatDate`, `formatTime`), so screens, emails and exports agree.
 */
const numberFormat = new Intl.NumberFormat('he-IL');

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}
