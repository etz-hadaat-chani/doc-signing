import { useQuery } from '@tanstack/react-query';
import { employeeKeys, fetchDepartments } from './employees.api';

/** Every department (filter and form). Empty while loading or if it failed: filters still work. */
export function useDepartments() {
  const { data } = useQuery({
    queryKey: employeeKeys.departments,
    queryFn: ({ signal }) => fetchDepartments(signal),
  });
  return data ?? [];
}
