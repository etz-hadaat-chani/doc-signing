import { formatDepartment } from '@doc-signing/shared';

export interface FilterOption {
  value: string;
  label: string;
}

/** Departments for a list or filter: sorted by code, shown as "15 - name" (PRD §7). */
export function departmentOptions(
  departments: readonly { id: string; code: number; name: string }[],
): FilterOption[] {
  return [...departments]
    .sort((a, b) => a.code - b.code)
    .map((department) => ({
      value: department.id,
      label: formatDepartment(department.code, department.name),
    }));
}
