import {
  ALREADY_SIGNED_CHOICES,
  formatTime,
  type RecipientsPreviewReport,
} from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { errorContent } from '../../../components/feedback/error-content';
import { ErrorState } from '../../../components/feedback/ErrorState';
import { PageLoader } from '../../../components/feedback/PageLoader';
import { CountTiles } from '../../../components/stats/CountTiles';
import { ToneChip } from '../../../components/status/StatusChip';
import { ROUND_DEPARTMENT_LOOKS } from '../../../components/status/status-tones';
import type { Column } from '../../../components/table/DataTable';
import { MemoryTable } from '../../../components/table/MemoryTable';
import { he } from '../../../i18n/he';
import { SummaryLists } from './SummaryLists';
import {
  blockerLines,
  choiceValue,
  type IssueLine,
  reasonTexts,
  summaryTiles,
  warningLines,
} from './summary-view';
import { previewStatus, type WizardAction, type WizardState } from './wizard-state';

const texts = he.newRound.summary;
const columns = he.newRound.columns;

type Department = RecipientsPreviewReport['departments'][number];

function IssueList({ lines }: { lines: readonly IssueLine[] }) {
  return (
    <Box component="ul" sx={{ m: 0, paddingInlineStart: 3 }}>
      {lines.map((line) => (
        <li key={line.key}>
          {line.text}
          {line.reasons.length > 0 && (
            <Box component="ul" sx={{ m: 0, paddingInlineStart: 3 }}>
              {line.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </Box>
          )}
        </li>
      ))}
    </Box>
  );
}

function Issues({ report }: { report: RecipientsPreviewReport }) {
  const blockers = blockerLines(report);
  const warnings = warningLines(report);
  return (
    <>
      {blockers.length > 0 && (
        <Alert severity="error" role="alert" data-testid="round-blockers">
          <AlertTitle>{texts.blockersTitle}</AlertTitle>
          <IssueList lines={blockers} />
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert severity="warning" role="note" data-testid="round-warnings">
          <AlertTitle>{texts.warningsTitle}</AlertTitle>
          <IssueList lines={warnings} />
        </Alert>
      )}
      {report.canCreate && (
        <Alert severity="success" role="note">
          {texts.canCreate}
        </Alert>
      )}
    </>
  );
}

function templateText({ name, version }: { name: string; version: number }) {
  return texts.templateName(name, version);
}

/** The department's template: a choice where it has several (by_department), else its name. */
function TemplateCell({
  department,
  state,
  disabled,
  dispatch,
}: {
  department: Department;
  state: WizardState;
  disabled: boolean;
  dispatch: (action: WizardAction) => void;
}) {
  if (state.mode === 'by_department' && department.options.length > 1) {
    return (
      <TextField
        select
        size="small"
        label={texts.chooseTemplate(department.label)}
        value={choiceValue(department, state.departmentChoices)}
        disabled={disabled}
        onChange={(event) =>
          dispatch({
            type: 'departmentChoice',
            departmentId: department.id,
            templateId: event.target.value,
          })
        }
        sx={{ minWidth: 240 }}
      >
        <MenuItem value="" disabled>
          {texts.chooseOption}
        </MenuItem>
        {department.options.map((option) => (
          <MenuItem key={option.id} value={option.id}>
            {templateText(option)}
          </MenuItem>
        ))}
      </TextField>
    );
  }
  return department.template ? <bdi>{templateText(department.template)}</bdi> : texts.none;
}

function departmentColumns(
  state: WizardState,
  disabled: boolean,
  dispatch: (action: WizardAction) => void,
): Column<Department>[] {
  return [
    { key: 'department', header: columns.department, render: (row) => row.label },
    { key: 'recipients', header: columns.recipients, render: (row) => row.recipients },
    {
      key: 'status',
      header: columns.status,
      render: (row) => {
        const look = ROUND_DEPARTMENT_LOOKS[row.status];
        return (
          <ToneChip label={texts.departmentStatus[row.status]} tone={look.tone} icon={look.icon} />
        );
      },
    },
    {
      key: 'template',
      header: columns.template,
      render: (row) => (
        <TemplateCell department={row} state={state} disabled={disabled} dispatch={dispatch} />
      ),
    },
    {
      key: 'notOffered',
      header: columns.notOffered,
      render: (row) =>
        row.notOffered.length === 0 ? (
          texts.none
        ) : (
          <IssueList
            lines={row.notOffered.map((template) => ({
              key: template.id,
              text: templateText(template),
              reasons: reasonTexts(template.reasons),
            }))}
          />
        ),
    },
  ];
}

/**
 * Step 4: the recipient preview (FR-RND-4). Asked for only on entering the step or on "refresh"
 * (each call writes an audit row), never on a timer. Counts, what blocks the round, each
 * department's template (and the choice where it has several), and who is missing what.
 */
export function SummaryStep({
  state,
  pending,
  error,
  onRefresh,
  dispatch,
}: {
  state: WizardState;
  pending: boolean;
  error: unknown;
  onRefresh: () => void;
  dispatch: (action: WizardAction) => void;
}) {
  const result = state.preview;
  const status = previewStatus(state);

  if (!result) {
    if (pending) return <PageLoader />;
    return (
      <ErrorState
        {...errorContent(error)}
        title={texts.failed}
        headingComponent="h3"
        onRetry={onRefresh}
      />
    );
  }
  const { report } = result;

  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
        <Button variant="outlined" onClick={onRefresh} disabled={pending}>
          {pending ? texts.refreshing : texts.refresh}
        </Button>
        <Typography color="text.secondary">
          {texts.updatedAt(formatTime(result.receivedAt))}
        </Typography>
      </Box>
      {status === 'stale' && (
        <Alert
          severity="warning"
          role="alert"
          action={
            <Button color="inherit" variant="outlined" onClick={onRefresh} disabled={pending}>
              {texts.update}
            </Button>
          }
        >
          {texts.stale}
        </Alert>
      )}

      <CountTiles label={texts.countsLabel} tiles={summaryTiles(report)} fit />

      <FormControl disabled={pending}>
        <FormLabel id="round-already-signed">{texts.alreadySignedLabel}</FormLabel>
        <RadioGroup
          row
          aria-labelledby="round-already-signed"
          value={state.alreadySigned}
          onChange={(_event, value) => {
            const choice = ALREADY_SIGNED_CHOICES.find((option) => option === value);
            if (choice) dispatch({ type: 'alreadySigned', choice });
          }}
        >
          {ALREADY_SIGNED_CHOICES.map((choice) => (
            <FormControlLabel
              key={choice}
              value={choice}
              control={<Radio />}
              label={texts.alreadySignedChoices[choice]}
            />
          ))}
        </RadioGroup>
      </FormControl>

      <Issues report={report} />

      {report.departments.length > 0 && (
        <Box component="section" aria-labelledby="round-departments-title">
          <Typography variant="h3" id="round-departments-title" sx={{ mb: 1 }}>
            {texts.departmentsTitle}
          </Typography>
          <MemoryTable
            caption={texts.departmentsCaption}
            columns={departmentColumns(state, pending, dispatch)}
            items={report.departments}
            getRowId={(row) => row.id}
          />
        </Box>
      )}

      <SummaryLists report={report} />
    </>
  );
}
