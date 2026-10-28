import { ROUND_MAX_EMPLOYEE_IDS } from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import Typography from '@mui/material/Typography';
import { DepartmentPicker } from '../../../components/forms/DepartmentPicker';
import type { Column } from '../../../components/table/DataTable';
import { MemoryTable } from '../../../components/table/MemoryTable';
import { formatNumber } from '../../../i18n/format';
import { he } from '../../../i18n/he';
import { useDepartments } from '../../employees/use-departments';
import { employeeColumns, fullName } from './employee-columns';
import { EmployeePicker } from './EmployeePicker';
import { problemText } from './problem-text';
import type { PickedEmployee, StepProblem, WizardAction, WizardState } from './wizard-state';

const texts = he.newRound.recipients;

/**
 * Step 3: who gets the round (FR-RND-2), combinable: all employees, departments ("15 - name",
 * sorted by code) and hand-picked employees, kept across searches.
 */
export function RecipientsStep({
  state,
  problem,
  dispatch,
}: {
  state: WizardState;
  problem: StepProblem | null;
  dispatch: (action: WizardAction) => void;
}) {
  const departments = useDepartments();
  const pickedIds = new Set(state.employees.map(({ id }) => id));
  const atLimit = state.employees.length >= ROUND_MAX_EMPLOYEE_IDS;
  const inactive = state.employees.filter(({ isActive }) => !isActive).length;

  const removeColumn: Column<PickedEmployee> = {
    key: 'actions',
    header: he.newRound.columns.actions,
    render: (row) => (
      <Button
        size="small"
        variant="outlined"
        aria-label={texts.removeLabel(fullName(row))}
        onClick={() => dispatch({ type: 'removeEmployee', employeeId: row.id })}
      >
        {texts.remove}
      </Button>
    ),
  };

  return (
    <>
      <Typography color="text.secondary">{texts.intro}</Typography>
      {problem !== null && (
        <FormHelperText error role="alert" sx={{ mx: 0 }}>
          {problemText(problem)}
        </FormHelperText>
      )}
      <FormControlLabel
        control={
          <Checkbox
            checked={state.all}
            onChange={(event) => dispatch({ type: 'all', all: event.target.checked })}
          />
        }
        label={texts.all}
      />
      <Box sx={{ maxWidth: 640 }}>
        <DepartmentPicker
          id="round-departments"
          departments={departments}
          value={state.departmentIds}
          onChange={(departmentIds) => dispatch({ type: 'departments', departmentIds })}
          helperText={texts.departmentsHint}
        />
      </Box>

      <Box component="section" aria-labelledby="round-employees" sx={{ display: 'grid', gap: 2 }}>
        <Typography variant="h3" id="round-employees">
          {texts.employeesTitle}
        </Typography>
        <EmployeePicker
          isPicked={(id) => pickedIds.has(id)}
          canPick={!atLimit}
          onPick={(employee) => dispatch({ type: 'addEmployee', employee })}
        />
        {atLimit && (
          <Alert severity="info" role="note">
            {texts.limitReached(formatNumber(ROUND_MAX_EMPLOYEE_IDS))}
          </Alert>
        )}
        <Typography role="status">
          {state.employees.length === 0
            ? texts.nonePicked
            : texts.pickedCount(state.employees.length, formatNumber(state.employees.length))}
        </Typography>
        {state.employees.length > 0 && (
          <MemoryTable
            caption={texts.pickedCaption}
            columns={[...employeeColumns(), removeColumn]}
            items={state.employees}
            getRowId={(row) => row.id}
          />
        )}
        {inactive > 0 && (
          <Alert severity="warning" role="note">
            {texts.inactivePicked(inactive, formatNumber(inactive))}
          </Alert>
        )}
      </Box>
    </>
  );
}
