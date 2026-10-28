import type { ImportPreview } from '@doc-signing/shared';
import { CountTiles } from '../../../components/stats/CountTiles';

type Counts = ImportPreview['counts'];
type CountKey = Exclude<keyof Counts, 'rowsTotal'>;

const EMPLOYEE_COUNTS: readonly CountKey[] = [
  'rowsNew',
  'rowsUpdated',
  'rowsUnchanged',
  'rowsFailed',
];
const DEPARTMENT_COUNTS: readonly CountKey[] = ['departmentsNew', 'departmentsRenamed'];

/** The import's numbers as tiles; department tiles only when there are any. */
export function ImportCounts({
  counts,
  labels,
  label,
}: {
  counts: Counts;
  labels: Record<CountKey, string>;
  label: string;
}) {
  const shown = [...EMPLOYEE_COUNTS, ...DEPARTMENT_COUNTS.filter((key) => counts[key] > 0)];
  return (
    <CountTiles
      label={label}
      tiles={shown.map((key) => ({ key, label: labels[key], value: counts[key] }))}
    />
  );
}
