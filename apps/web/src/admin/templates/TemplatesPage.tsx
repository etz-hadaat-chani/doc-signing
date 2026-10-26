import { formatDate, type TemplateItem, templateListQuerySchema } from '@doc-signing/shared';
import AddOutlined from '@mui/icons-material/AddOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router';
import { type Column, DataTable } from '../../components/table/DataTable';
import { DepartmentFilter, FilterBar } from '../../components/table/filters';
import { useTableQuery } from '../../components/table/use-table-query';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';
import { useDepartments } from '../employees/use-departments';
import { TemplateStateChips } from './TemplateStateChips';
import { departmentLabels, reasonLines, reasonText, templateState } from './template-view';
import { fetchTemplates, templateKeys } from './templates.api';

const text = he.templates;

/** The state chips; a template that isn't ready also lists why (FR-TPL-8). */
function StateCell({ item }: { item: TemplateItem }) {
  const reasons = templateState(item) === 'not_ready' ? reasonLines(item) : [];
  return (
    <>
      <TemplateStateChips item={item} />
      {reasons.length > 0 && (
        <Box
          component="ul"
          sx={{ m: 0, mt: 1, ps: 2.5, fontSize: tokens.font.size.small, color: 'text.secondary' }}
        >
          {reasons.map((line) => (
            <li key={line.code}>{reasonText(line)}</li>
          ))}
        </Box>
      )}
    </>
  );
}

const COLUMNS: readonly Column<TemplateItem>[] = [
  {
    key: 'name',
    header: text.columns.name,
    render: (item) => (
      <Link component={RouterLink} to={`/templates/${item.id}`}>
        {item.name}
      </Link>
    ),
  },
  {
    key: 'departments',
    header: text.columns.departments,
    render: (item) => {
      const labels = departmentLabels(item);
      if (labels.length === 0) return text.emptyValue;
      // One department per line, so a "code - name" never breaks between lines.
      return (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {labels.map((label) => (
            <Box component="li" key={label} sx={{ whiteSpace: 'nowrap' }}>
              {label}
            </Box>
          ))}
        </Box>
      );
    },
  },
  {
    key: 'version',
    header: text.columns.version,
    render: (item) => (
      <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
        {text.version(item.version)}
      </Box>
    ),
  },
  { key: 'state', header: text.columns.status, render: (item) => <StateCell item={item} /> },
  {
    key: 'updatedAt',
    header: text.columns.updatedAt,
    render: (item) => formatDate(item.updatedAt),
  },
];

/**
 * Templates (A9), managers only: every active template (or with archived and old versions too),
 * with its departments, version and whether it is ready for a round. Filters in the address:
 * the department id and "include archived" only, nothing personal.
 */
export function TemplatesPage() {
  const departments = useDepartments();
  const { query, setQuery } = useTableQuery(templateListQuerySchema);
  const templates = useQuery({
    queryKey: templateKeys.list(query),
    queryFn: ({ signal }) => fetchTemplates(query, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 4 }}>
        <Typography variant="h1">{he.nav.templates}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          component={RouterLink}
          to="/templates/new"
          startIcon={<AddOutlined />}
        >
          {text.add}
        </Button>
      </Box>

      <FilterBar>
        <DepartmentFilter
          departments={departments}
          value={query.dept}
          onChange={(dept) => setQuery({ dept })}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={query.includeArchived}
              onChange={(event) => setQuery({ includeArchived: event.target.checked })}
            />
          }
          label={text.includeArchived}
        />
      </FilterBar>

      <DataTable
        caption={text.listCaption}
        columns={COLUMNS}
        getRowId={(item) => item.id}
        data={templates.data}
        isLoading={templates.isPending}
        error={templates.error}
        onRetry={() => void templates.refetch()}
        page={query.page}
        pageSize={query.pageSize}
        onPageChange={(page) => setQuery({ page })}
        onPageSizeChange={(pageSize) => setQuery({ pageSize })}
        emptyText={text.empty}
      />
    </>
  );
}
