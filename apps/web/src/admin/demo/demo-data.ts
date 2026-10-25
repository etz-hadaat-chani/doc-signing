import {
  DISPLAY_STATUSES,
  type DisplayStatus,
  type Department,
  type Paged,
} from '@doc-signing/shared';
import { ApiRequestError } from '../../api/api-error';
import { he } from '../../i18n/he';

// Made-up data for the components demo only: no real names, no ID numbers.

export interface DemoRow {
  id: string;
  name: string;
  employeeNumber: string;
  department: Department;
  status: DisplayStatus;
}

export type DemoMode = 'normal' | 'error' | 'empty';

const LETTERS = ['א', 'ב', 'ג', 'ד'];
// Out of order on purpose: the filter sorts them by code.
const CODES = [15, 3, 120, 10];

export const DEMO_DEPARTMENTS: Department[] = CODES.map((code, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  code,
  name: he.demo.departmentName(LETTERS[index] ?? ''),
  isActive: true,
}));

const ROW_COUNT = 120;

const DEMO_ROWS: DemoRow[] = Array.from({ length: ROW_COUNT }, (_, index) => {
  const number = index + 1;
  return {
    id: `demo-${number}`,
    name: he.demo.employeeName(number),
    employeeNumber: `D-${String(number).padStart(4, '0')}`,
    department: DEMO_DEPARTMENTS[index % DEMO_DEPARTMENTS.length]!,
    status: DISPLAY_STATUSES[index % DISPLAY_STATUSES.length]!,
  };
});

export interface DemoQuery {
  page: number;
  pageSize: number;
  status?: DisplayStatus | undefined;
  dept?: string | undefined;
}

const DELAY_MS = 400;

/** Acts like a list endpoint (with the search text in the body): filters, then one page. */
export async function fetchDemoPage(
  query: DemoQuery,
  search: string,
  mode: DemoMode,
): Promise<Paged<DemoRow>> {
  await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  if (mode === 'error') throw new ApiRequestError({ kind: 'network' });
  const matching =
    mode === 'empty'
      ? []
      : DEMO_ROWS.filter(
          (row) =>
            (!query.status || row.status === query.status) &&
            (!query.dept || row.department.id === query.dept) &&
            (!search || row.name.includes(search) || row.employeeNumber.includes(search)),
        );
  const start = (query.page - 1) * query.pageSize;
  return {
    items: matching.slice(start, start + query.pageSize),
    total: matching.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}
