/** A department as HR knows it from Har Gal: "15 - name" (PRD §7). */
export function formatDepartment(code: number, name: string): string {
  return `${code} - ${name}`;
}
