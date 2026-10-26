import type { TemplateField } from '@doc-signing/shared';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { type Column, DataTable } from '../../components/table/DataTable';
import { DEFAULT_PAGE_SIZE } from '../../components/table/paging';
import { he } from '../../i18n/he';
import { pageOf } from '../employees/import/import-view';

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

/** The stored positions, read only (the position editor comes with part B of 5.4). */
export function TemplatePositions({ fields }: { fields: readonly TemplateField[] }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  return (
    <section aria-labelledby="template-positions">
      <Typography id="template-positions" variant="h2" sx={{ mb: 2 }}>
        {text.positionsTitle}
      </Typography>
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
