import { formatDepartment, type ImportPreview, type ImportRowIssue } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { type ReactNode, useId, useMemo, useState } from 'react';
import type { Column } from '../../../components/table/DataTable';
import { MemoryTable } from '../../../components/table/MemoryTable';
import { formatNumber } from '../../../i18n/format';
import { he } from '../../../i18n/he';
import { EmailStatusMark } from '../EmailStatusMark';
import { useDepartments } from '../use-departments';
import { type ChangeLine, parseChangeLine } from './import-view';

const texts = he.employeeImport;
const headers = texts.tableColumns;

type NewEmployee = ImportPreview['newEmployees'][number];
type UpdatedEmployee = ImportPreview['updatedEmployees'][number];
type Keyed<T> = T & { key: string };
type TabKind = keyof typeof texts.tabs;

/** A row can have more than one reason, so rows are told apart by their place in the list. */
function keyed<T extends object>(items: readonly T[]): Keyed<T>[] {
  return items.map((item, index) => ({ ...item, key: String(index) }));
}

const rowColumn = { key: 'row', header: headers.row, width: 72 };
const numberColumn = { key: 'employeeNumber', header: headers.employeeNumber };

const NEW_COLUMNS: readonly Column<Keyed<NewEmployee>>[] = [
  { ...rowColumn, render: (row) => <bdi>{row.row}</bdi> },
  { ...numberColumn, render: (row) => <bdi>{row.employeeNumber}</bdi> },
  { key: 'name', header: headers.name, render: (row) => row.fullName },
  { key: 'department', header: headers.department, render: (row) => row.department },
  {
    key: 'emailStatus',
    header: headers.emailStatus,
    render: (row) => <EmailStatusMark status={row.emailStatus} />,
  },
];

const ISSUE_COLUMNS: readonly Column<Keyed<ImportRowIssue>>[] = [
  { ...rowColumn, render: (row) => <bdi>{row.row}</bdi> },
  {
    ...numberColumn,
    render: (row) =>
      row.employeeNumber === null ? he.employees.emptyValue : <bdi>{row.employeeNumber}</bdi>,
  },
  { key: 'reason', header: headers.reason, render: (row) => row.message },
];

/** "field: old ← new"; each value isolated, so an email or a phone reads left to right. */
function ChangeText({ line }: { line: ChangeLine }) {
  if (line.kind === 'raw') return <bdi>{line.text}</bdi>;
  if (line.kind === 'changed') return <>{`${line.field}: ${texts.changed}`}</>;
  return (
    <>
      {`${line.field}: `}
      <bdi>{line.from}</bdi>
      {` ${texts.arrow} `}
      <bdi>{line.to}</bdi>
    </>
  );
}

/** A list kept in memory, its rows told apart by their place in the list. */
function KeyedTable<T extends { key: string }>(props: {
  caption: string;
  columns: readonly Column<T>[];
  items: readonly T[];
}) {
  return <MemoryTable {...props} getRowId={(row) => row.key} />;
}

function DepartmentList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <Typography variant="h3" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Box component="ul" sx={{ m: 0, paddingInlineStart: 3 }}>
        {children}
      </Box>
    </section>
  );
}

function DepartmentLists({ preview }: { preview: ImportPreview }) {
  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      {preview.newDepartments.length > 0 && (
        <DepartmentList title={texts.newDepartments}>
          {preview.newDepartments.map((department) => (
            <li key={department.code}>{formatDepartment(department.code, department.name)}</li>
          ))}
        </DepartmentList>
      )}
      {preview.renamedDepartments.length > 0 && (
        <DepartmentList title={texts.renamedDepartments}>
          {preview.renamedDepartments.map((department) => (
            <li key={department.code}>
              <bdi>{formatDepartment(department.code, department.from)}</bdi>
              {` ${texts.arrow} `}
              <bdi>{formatDepartment(department.code, department.to)}</bdi>
            </li>
          ))}
        </DepartmentList>
      )}
    </Box>
  );
}

/**
 * The check report (FR-EMP-2): one tab per part that has entries, each with its count. The
 * chosen tab and the pages are kept in memory only.
 */
export function ImportReport({ preview }: { preview: ImportPreview }) {
  const departments = useDepartments();
  const baseId = useId();
  const [chosen, setChosen] = useState<TabKind | null>(null);

  // The file's names win: a new code has no stored name, a renamed one gets its new name.
  const departmentLabel = useMemo(() => {
    const names = new Map(departments.map((d) => [d.code, d.name]));
    for (const d of preview.newDepartments) names.set(d.code, d.name);
    for (const d of preview.renamedDepartments) names.set(d.code, d.to);
    return (code: number) => {
      const name = names.get(code);
      return name === undefined ? undefined : formatDepartment(code, name);
    };
  }, [departments, preview]);

  const updatedColumns = useMemo<readonly Column<Keyed<UpdatedEmployee>>[]>(
    () => [
      { ...rowColumn, render: (row) => <bdi>{row.row}</bdi> },
      { ...numberColumn, render: (row) => <bdi>{row.employeeNumber}</bdi> },
      { key: 'name', header: headers.name, render: (row) => row.fullName },
      {
        key: 'changes',
        header: headers.changes,
        render: (row) => (
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {row.changes.map((change, index) => (
              <li key={index}>
                <ChangeText line={parseChangeLine(change, departmentLabel)} />
              </li>
            ))}
          </Box>
        ),
      },
    ],
    [departmentLabel],
  );

  const counts: Record<TabKind, number> = {
    new: preview.newEmployees.length,
    updated: preview.updatedEmployees.length,
    errors: preview.errors.length,
    warnings: preview.warnings.length,
    departments: preview.newDepartments.length + preview.renamedDepartments.length,
  };
  const tabs = (Object.keys(counts) as TabKind[]).filter((kind) => counts[kind] > 0);
  const current = tabs.find((kind) => kind === chosen) ?? tabs[0];
  if (!current) return null;

  const tabId = (kind: TabKind) => `${baseId}-tab-${kind}`;
  const panelId = (kind: TabKind) => `${baseId}-panel-${kind}`;

  const panels: Record<TabKind, () => ReactNode> = {
    new: () => (
      <KeyedTable
        caption={texts.tabs.new}
        columns={NEW_COLUMNS}
        items={keyed(preview.newEmployees)}
      />
    ),
    updated: () => (
      <KeyedTable
        caption={texts.tabs.updated}
        columns={updatedColumns}
        items={keyed(preview.updatedEmployees)}
      />
    ),
    errors: () => (
      <KeyedTable
        caption={texts.tabs.errors}
        columns={ISSUE_COLUMNS}
        items={keyed(preview.errors)}
      />
    ),
    warnings: () => (
      <>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {texts.warningsHint}
        </Typography>
        <KeyedTable
          caption={texts.tabs.warnings}
          columns={ISSUE_COLUMNS}
          items={keyed(preview.warnings)}
        />
      </>
    ),
    departments: () => <DepartmentLists preview={preview} />,
  };

  return (
    <Box component="section" aria-label={texts.reportLabel}>
      <Tabs
        value={current}
        onChange={(_event, value: TabKind) => setChosen(value)}
        aria-label={texts.reportLabel}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        {tabs.map((kind) => (
          <Tab
            key={kind}
            value={kind}
            id={tabId(kind)}
            aria-controls={panelId(kind)}
            label={texts.tabWithCount(texts.tabs[kind], formatNumber(counts[kind]))}
          />
        ))}
      </Tabs>
      {/* Keyed by tab, so each list starts again at its first page. */}
      <Box role="tabpanel" key={current} id={panelId(current)} aria-labelledby={tabId(current)}>
        {panels[current]()}
      </Box>
    </Box>
  );
}
