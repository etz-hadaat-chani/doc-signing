import {
  formatDate,
  NO_EMAIL_REASONS,
  RECIPIENT_TEXT_WARNINGS,
  type RecipientsPreviewReport,
  SIGN_METHOD_LABELS,
  STATUS_LABELS,
} from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { type ReactNode, useId, useState } from 'react';
import type { Column } from '../../../components/table/DataTable';
import { MemoryTable } from '../../../components/table/MemoryTable';
import { formatNumber } from '../../../i18n/format';
import { he } from '../../../i18n/he';
import { hiddenRows, type ListKind, listKinds } from './summary-view';

const texts = he.newRound.summary;
const columns = he.newRound.columns;

type Lists = RecipientsPreviewReport['lists'];
type Row<K extends ListKind> = Lists[K]['items'][number];

/** Number, name and department: the columns every list starts with. */
function baseColumns<T extends Row<'inactivePicked'>>(): Column<T>[] {
  return [
    {
      key: 'employeeNumber',
      header: columns.employeeNumber,
      render: (row) => <bdi>{row.employeeNumber}</bdi>,
    },
    { key: 'name', header: columns.name, render: (row) => <bdi>{row.name}</bdi> },
    { key: 'department', header: columns.department, render: (row) => row.department },
  ];
}

const roundColumn = <T extends { roundName: string }>(): Column<T> => ({
  key: 'round',
  header: columns.round,
  render: (row) => <bdi>{row.roundName}</bdi>,
});

const LIST_COLUMNS: { [K in ListKind]: () => Column<Row<K>>[] } = {
  missingData: () => [
    ...baseColumns(),
    {
      key: 'missing',
      header: columns.missing,
      render: (row) => row.missing.map(({ name }) => name).join(', '),
    },
  ],
  noEmail: () => [
    ...baseColumns(),
    { key: 'reason', header: columns.reason, render: (row) => NO_EMAIL_REASONS[row.reason] },
  ],
  textWarnings: () => [
    ...baseColumns(),
    {
      key: 'warnings',
      header: columns.warnings,
      render: (row) => (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {row.warnings.map((warning) => (
            <li key={warning.code}>
              {`${RECIPIENT_TEXT_WARNINGS[warning.code]} (${warning.keys.map(({ name }) => name).join(', ')})`}
            </li>
          ))}
        </Box>
      ),
    },
  ],
  alreadySigned: () => [
    ...baseColumns(),
    roundColumn(),
    { key: 'version', header: columns.version, render: (row) => row.templateVersion },
    {
      key: 'signedAt',
      header: columns.signedAt,
      render: (row) => (row.signedAt === null ? texts.none : formatDate(row.signedAt)),
    },
    {
      key: 'signMethod',
      header: columns.signMethod,
      render: (row) => (row.signMethod === null ? texts.none : SIGN_METHOD_LABELS[row.signMethod]),
    },
  ],
  alreadyOpen: () => [
    ...baseColumns(),
    roundColumn(),
    { key: 'status', header: columns.assignmentStatus, render: (row) => STATUS_LABELS[row.status] },
  ],
  inactivePicked: () => baseColumns(),
};

function ListPanel<K extends ListKind>({
  kind,
  list,
  hint,
}: {
  kind: K;
  list: Lists[K];
  hint: string;
}) {
  const hidden = hiddenRows(list);
  const items: readonly Row<K>[] = list.items;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Typography color="text.secondary">{hint}</Typography>
      <MemoryTable
        caption={texts.tabs[kind]}
        columns={LIST_COLUMNS[kind]()}
        items={items}
        getRowId={(row) => row.employeeId}
      />
      {hidden > 0 && <Typography>{texts.moreRows(formatNumber(hidden))}</Typography>}
    </Box>
  );
}

/**
 * Who is missing what, who gets no email, text that won't fit, who already signed or has the
 * document open elsewhere, and inactive employees picked by hand: one tab per list that has
 * anyone, each paged in memory. Field and box names only, never a value.
 */
export function SummaryLists({ report }: { report: RecipientsPreviewReport }) {
  const baseId = useId();
  const [chosen, setChosen] = useState<ListKind | null>(null);
  const kinds = listKinds(report);
  const current = kinds.find((kind) => kind === chosen) ?? kinds[0];
  if (!current) return null;

  const hints: Record<ListKind, string> = {
    ...texts.listHints,
    alreadySigned: texts.listHints.alreadySigned[report.alreadySigned],
  };
  const panels: { [K in ListKind]: () => ReactNode } = {
    missingData: () => (
      <ListPanel kind="missingData" list={report.lists.missingData} hint={hints.missingData} />
    ),
    noEmail: () => <ListPanel kind="noEmail" list={report.lists.noEmail} hint={hints.noEmail} />,
    textWarnings: () => (
      <ListPanel kind="textWarnings" list={report.lists.textWarnings} hint={hints.textWarnings} />
    ),
    alreadySigned: () => (
      <ListPanel
        kind="alreadySigned"
        list={report.lists.alreadySigned}
        hint={hints.alreadySigned}
      />
    ),
    alreadyOpen: () => (
      <ListPanel kind="alreadyOpen" list={report.lists.alreadyOpen} hint={hints.alreadyOpen} />
    ),
    inactivePicked: () => (
      <ListPanel
        kind="inactivePicked"
        list={report.lists.inactivePicked}
        hint={hints.inactivePicked}
      />
    ),
  };
  const tabId = (kind: ListKind) => `${baseId}-tab-${kind}`;
  const panelId = (kind: ListKind) => `${baseId}-panel-${kind}`;

  return (
    <Box component="section" aria-label={texts.listsLabel}>
      <Tabs
        value={current}
        onChange={(_event, value: ListKind) => setChosen(value)}
        aria-label={texts.listsLabel}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        {kinds.map((kind) => (
          <Tab
            key={kind}
            value={kind}
            id={tabId(kind)}
            aria-controls={panelId(kind)}
            label={texts.tabWithCount(texts.tabs[kind], formatNumber(report.lists[kind].total))}
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
