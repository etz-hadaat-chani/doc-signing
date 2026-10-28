import type { TemplateField } from '@doc-signing/shared';
import EditOutlined from '@mui/icons-material/EditOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { type Column, DataTable } from '../../components/table/DataTable';
import { DEFAULT_PAGE_SIZE, pageOf } from '../../components/table/paging';
import { he } from '../../i18n/he';

const text = he.templates.details;
const none = he.templates.emptyValue;

const COLUMNS: readonly Column<TemplateField>[] = [
  {
    key: 'type',
    header: text.positionColumns.type,
    render: (field) => he.templates.fieldTypes[field.fieldType],
  },
  {
    key: 'key',
    header: text.positionColumns.key,
    render: (field) => <bdi dir="ltr">{field.key}</bdi>,
  },
  { key: 'label', header: text.positionColumns.label, render: (field) => field.label ?? none },
  {
    key: 'fillMode',
    header: text.positionColumns.fillMode,
    render: (field) => (field.fillMode ? he.templates.fillModes[field.fillMode] : none),
  },
  { key: 'page', header: text.positionColumns.page, render: (field) => field.page },
];

/** The stored positions, read only, with a way to the position editor on an editable version. */
export function TemplatePositions({
  fields,
  editPath,
}: {
  fields: readonly TemplateField[];
  editPath: string | null;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  return (
    <section aria-labelledby="template-positions">
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography id="template-positions" variant="h2">
          {text.positionsTitle}
        </Typography>
        {editPath && (
          <Button
            component={RouterLink}
            to={editPath}
            variant="contained"
            startIcon={<EditOutlined />}
          >
            {text.editPositions}
          </Button>
        )}
      </Box>
      <DataTable
        caption={text.positionsCaption}
        columns={COLUMNS}
        getRowId={(field) => field.id}
        data={pageOf(fields, page, pageSize)}
        isLoading={false}
        error={null}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        emptyText={text.noPositions}
      />
    </section>
  );
}
