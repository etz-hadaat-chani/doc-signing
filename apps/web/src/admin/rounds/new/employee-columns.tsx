import type { Column } from '../../../components/table/DataTable';
import { he } from '../../../i18n/he';
import { ActiveMark, EmailStatusMark } from '../../employees/EmailStatusMark';
import type { PickedEmployee } from './wizard-state';

const columns = he.newRound.columns;

export const fullName = (employee: { firstName: string; lastName: string }) =>
  `${employee.firstName} ${employee.lastName}`;

/** Number, name, department, email status and active: never the ID number or the address. */
export function employeeColumns<T extends PickedEmployee>(): Column<T>[] {
  return [
    {
      key: 'employeeNumber',
      header: columns.employeeNumber,
      render: (row) => <bdi>{row.employeeNumber}</bdi>,
    },
    { key: 'name', header: columns.name, render: (row) => <bdi>{fullName(row)}</bdi> },
    { key: 'department', header: columns.department, render: (row) => row.department },
    {
      key: 'emailStatus',
      header: columns.emailStatus,
      render: (row) => <EmailStatusMark status={row.emailStatus} />,
    },
    {
      key: 'active',
      header: columns.active,
      render: (row) => <ActiveMark isActive={row.isActive} />,
    },
  ];
}
