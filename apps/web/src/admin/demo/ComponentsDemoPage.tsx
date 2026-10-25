import {
  DISPLAY_STATUSES,
  displayStatusSchema,
  EMPLOYER_SIGNATURE_MAX_BYTES,
  formatDepartment,
  IMPORT_MAX_FILE_BYTES,
  optionalQuery,
  pageQuerySchema,
  ROUND_STATUSES,
  STATUS_LABELS,
} from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { z } from 'zod';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog';
import { useNotify } from '../../components/notifications/notify-context';
import { RoundStatusChip, StatusChip } from '../../components/status/StatusChip';
import { type Column, DataTable } from '../../components/table/DataTable';
import {
  DepartmentFilter,
  FilterBar,
  SearchField,
  SelectFilter,
} from '../../components/table/filters';
import { useTableQuery } from '../../components/table/use-table-query';
import { FileDropZone } from '../../components/upload/FileDropZone';
import { he } from '../../i18n/he';
import { DEMO_DEPARTMENTS, type DemoMode, type DemoRow, fetchDemoPage } from './demo-data';

/** Every shared component with made-up data (4.2). Exists only in `pnpm dev`. */
export function ComponentsDemoPage() {
  return (
    <>
      <Typography variant="h1" sx={{ mb: 1 }}>
        {he.nav.componentsDemo}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 5 }}>
        {he.demo.intro}
      </Typography>
      <ChipsDemo />
      <TableDemo />
      <DialogsDemo />
      <UploadDemo />
      <NotificationsDemo />
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" sx={{ mb: 6 }}>
      <Typography variant="h2" sx={{ mb: 2 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

const rowWrap = { display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 2 } as const;

function ChipsDemo() {
  return (
    <Section title={he.demo.chipsTitle}>
      <Typography variant="h3" sx={{ mb: 1 }}>
        {he.demo.assignmentChips}
      </Typography>
      <Box sx={rowWrap}>
        {DISPLAY_STATUSES.map((status) => (
          <StatusChip key={status} status={status} />
        ))}
      </Box>
      <Typography variant="h3" sx={{ mb: 1 }}>
        {he.demo.roundChips}
      </Typography>
      <Box sx={rowWrap}>
        {ROUND_STATUSES.map((status) => (
          <RoundStatusChip key={status} status={status} />
        ))}
      </Box>
    </Section>
  );
}

const demoQuerySchema = pageQuerySchema.extend({
  status: optionalQuery(displayStatusSchema),
  dept: optionalQuery(z.uuid()),
});

const STATUS_OPTIONS = DISPLAY_STATUSES.map((status) => ({
  value: status,
  label: STATUS_LABELS[status],
}));

const COLUMNS: Column<DemoRow>[] = [
  { key: 'name', header: he.demo.columnName, render: (row) => row.name },
  {
    key: 'employeeNumber',
    header: he.demo.columnEmployeeNumber,
    render: (row) => <bdi>{row.employeeNumber}</bdi>,
  },
  {
    key: 'department',
    header: he.demo.columnDepartment,
    render: (row) => formatDepartment(row.department.code, row.department.name),
  },
  {
    key: 'status',
    header: he.demo.columnStatus,
    render: (row) => <StatusChip status={row.status} />,
  },
];

const MODES: { value: DemoMode; label: string }[] = [
  { value: 'normal', label: he.demo.modeNormal },
  { value: 'error', label: he.demo.modeError },
  { value: 'empty', label: he.demo.modeEmpty },
];

function TableDemo() {
  const notify = useNotify();
  const { query, setQuery } = useTableQuery(demoQuerySchema);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<DemoMode>('normal');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const result = useQuery({
    queryKey: ['demo', 'components', query, search, mode],
    queryFn: () => fetchDemoPage(query, search, mode),
    placeholderData: keepPreviousData,
    retry: false,
  });

  return (
    <Section title={he.demo.tableTitle}>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {he.demo.tableHint}
      </Typography>
      <FilterBar>
        <SearchField
          onSearch={(text) => {
            setSearch(text);
            setQuery({ page: 1 });
          }}
        />
        <SelectFilter
          label={he.filters.status}
          value={query.status}
          options={STATUS_OPTIONS}
          onChange={(value) => setQuery({ status: displayStatusSchema.optional().parse(value) })}
        />
        <DepartmentFilter
          departments={DEMO_DEPARTMENTS}
          value={query.dept}
          onChange={(dept) => setQuery({ dept })}
        />
        <ToggleButtonGroup
          exclusive
          value={mode}
          onChange={(_event, value: DemoMode | null) => {
            if (value) setMode(value);
          }}
          aria-label={he.demo.modeLabel}
        >
          {MODES.map((option) => (
            <ToggleButton key={option.value} value={option.value}>
              {option.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </FilterBar>
      <DataTable<DemoRow>
        caption={he.demo.tableCaption}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        data={result.data}
        isLoading={result.isPending}
        error={result.error}
        onRetry={() => void result.refetch()}
        page={query.page}
        pageSize={query.pageSize}
        onPageChange={(page) => setQuery({ page })}
        onPageSizeChange={(pageSize) => setQuery({ pageSize })}
        selection={{
          selected,
          onChange: setSelected,
          rowLabel: (row) => row.name,
          resetKey: JSON.stringify([query.status, query.dept, search, mode]),
          actions: (
            <Button
              variant="contained"
              onClick={() => {
                notify.success(he.demo.sentToSelected(selected.size));
                setSelected(new Set());
              }}
            >
              {he.demo.sendSelected}
            </Button>
          ),
        }}
      />
    </Section>
  );
}

const FAKE_WORK_MS = 1000;

function DialogsDemo() {
  const notify = useNotify();
  const [open, setOpen] = useState<'normal' | 'danger' | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = () => {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setOpen(null);
      notify.success(he.demo.confirmed);
    }, FAKE_WORK_MS);
  };

  return (
    <Section title={he.demo.dialogsTitle}>
      <Box sx={rowWrap}>
        <Button variant="outlined" onClick={() => setOpen('normal')}>
          {he.demo.openNormal}
        </Button>
        <Button variant="outlined" color="error" onClick={() => setOpen('danger')}>
          {he.demo.openDanger}
        </Button>
      </Box>
      <ConfirmDialog
        open={open === 'normal'}
        title={he.demo.normalTitle}
        text={he.demo.normalText}
        confirmLabel={he.demo.normalConfirm}
        busy={busy}
        onConfirm={confirm}
        onClose={() => setOpen(null)}
      />
      <ConfirmDialog
        open={open === 'danger'}
        danger
        title={he.demo.dangerTitle}
        text={he.demo.dangerText}
        confirmLabel={he.demo.dangerConfirm}
        busy={busy}
        onConfirm={confirm}
        onClose={() => setOpen(null)}
      >
        <TextField label={he.demo.noteLabel} multiline minRows={2} fullWidth sx={{ mt: 2 }} />
      </ConfirmDialog>
    </Section>
  );
}

// The server takes PNG only for the employer signature (3.18 checks the content); no shared
// constant lists it yet, so the demo names it here.
const IMAGE_TYPES = { extensions: ['.png'], label: he.demo.imageTypes };
const EXCEL_TYPES = { extensions: ['.xlsx'], label: he.demo.excelTypes };

function UploadDemo() {
  const [excel, setExcel] = useState<File | null>(null);
  const [image, setImage] = useState<File | null>(null);
  return (
    <Section title={he.demo.uploadTitle}>
      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { md: '1fr 1fr' } }}>
        <Box>
          <Typography variant="h3" sx={{ mb: 1 }}>
            {he.demo.excelUpload}
          </Typography>
          <FileDropZone
            accept={EXCEL_TYPES}
            maxBytes={IMPORT_MAX_FILE_BYTES}
            file={excel}
            onFileChange={setExcel}
          />
        </Box>
        <Box>
          <Typography variant="h3" sx={{ mb: 1 }}>
            {he.demo.imageUpload}
          </Typography>
          <FileDropZone
            accept={IMAGE_TYPES}
            maxBytes={EMPLOYER_SIGNATURE_MAX_BYTES}
            file={image}
            onFileChange={setImage}
          />
        </Box>
      </Box>
    </Section>
  );
}

function NotificationsDemo() {
  const notify = useNotify();
  return (
    <Section title={he.demo.notificationsTitle}>
      <Box sx={rowWrap}>
        <Button variant="outlined" onClick={() => notify.success(he.demo.successText)}>
          {he.demo.showSuccess}
        </Button>
        <Button variant="outlined" onClick={() => notify.error(he.demo.errorText)}>
          {he.demo.showError}
        </Button>
      </Box>
    </Section>
  );
}
