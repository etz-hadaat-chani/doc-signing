import { type EmployeeCard, formatDayIL, formatDepartment } from '@doc-signing/shared';
import EditOutlined from '@mui/icons-material/EditOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { errorContent } from '../../components/feedback/error-content';
import { ErrorState } from '../../components/feedback/ErrorState';
import { PageLoader } from '../../components/feedback/PageLoader';
import { formatNumber } from '../../i18n/format';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';
import { useAuthUser } from '../auth/session';
import { ActiveMark, EmailStatusMark } from './EmailStatusMark';
import { EmployeeHistory } from './EmployeeHistory';
import { employeeKeys, fetchEmployee } from './employees.api';

const fields = he.employees.fields;
const none = he.employees.emptyValue;

/** Left to right inside Hebrew text: numbers, phones, email addresses. */
function Ltr({ children }: { children: string }) {
  return <bdi dir="ltr">{children}</bdi>;
}

const ltrOrNone = (value: string | null) => (value === null ? none : <Ltr>{value}</Ltr>);

function birthDateText(card: EmployeeCard): string {
  if (card.birthDate === null) return none;
  const date = formatDayIL(card.birthDate);
  return card.age === null ? date : he.employees.card.birthDateWithAge(date, card.age);
}

/** The card's details in FR-EMP-7 order. The ID number only when the API sent it (managers). */
function detailRows(card: EmployeeCard): [string, ReactNode][] {
  const rows: [string, ReactNode][] = [[fields.employeeNumber, <Ltr>{card.employeeNumber}</Ltr>]];
  if (card.idNumber !== undefined) rows.push([fields.idNumber, <Ltr>{card.idNumber}</Ltr>]);
  rows.push(
    [fields.department, formatDepartment(card.department.code, card.department.name)],
    [
      fields.email,
      <Box component="span" sx={{ display: 'inline-flex', flexWrap: 'wrap', gap: 1 }}>
        {card.email !== null && <Ltr>{card.email}</Ltr>}
        <EmailStatusMark status={card.emailStatus} />
      </Box>,
    ],
    [fields.landline, ltrOrNone(card.landline)],
    [fields.mobile, ltrOrNone(card.mobile)],
    [fields.address, card.address ?? none],
    [fields.city, card.city ?? none],
    [fields.birthDate, birthDateText(card)],
    [fields.jobTitle, card.jobTitle ?? none],
    [fields.employmentStatus, card.employmentStatus ?? none],
    [
      fields.jobPercent,
      card.jobPercent === null ? none : he.employees.card.jobPercent(formatNumber(card.jobPercent)),
    ],
    [fields.workDays, card.workDays ?? none],
    [fields.hoursBaseCode, card.hoursBaseLabel ?? none],
    [fields.pensionFundA, card.pensionFundA ?? none],
    [fields.pensionFundB, card.pensionFundB ?? none],
    [fields.studyFund, card.studyFund ?? none],
  );
  return rows;
}

function Details({ card }: { card: EmployeeCard }) {
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-labelledby="employee-details-title"
      sx={{ p: 3 }}
    >
      <Typography id="employee-details-title" variant="h2" sx={{ mb: 2 }}>
        {he.employees.card.detailsTitle}
      </Typography>
      <Box
        component="dl"
        sx={{
          m: 0,
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, minmax(0, 1fr))',
            lg: 'repeat(3, minmax(0, 1fr))',
          },
          columnGap: 4,
          rowGap: 2,
        }}
      >
        {detailRows(card).map(([label, value]) => (
          <Box key={label}>
            <Typography
              component="dt"
              color="text.secondary"
              sx={{ fontSize: tokens.font.size.small }}
            >
              {label}
            </Typography>
            <Typography component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>
              {value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/**
 * Employee card (A7): every detail of FR-EMP-7 and the history across rounds (FR-TRK-5). The
 * extra details appear only here (NFR-PRV-6). Managers get "edit"; officers see the same card
 * without the ID number (the API leaves it out).
 */
export function EmployeeCardPage() {
  const { employeeId = '' } = useParams();
  const { role } = useAuthUser();
  const navigate = useNavigate();
  const validId = isUuid(employeeId);
  const card = useQuery({
    queryKey: employeeKeys.card(employeeId),
    queryFn: ({ signal }) => fetchEmployee(employeeId, signal),
    enabled: validId,
  });

  if (!validId) {
    return (
      <ErrorState
        variant="notFound"
        title={he.feedback.notFoundTitle}
        message={he.feedback.notFoundText}
      />
    );
  }
  if (card.isPending) return <PageLoader />;
  if (!card.data) {
    return <ErrorState {...errorContent(card.error)} onRetry={() => void card.refetch()} />;
  }

  const employee = card.data;
  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 4 }}>
        <Box>
          <Typography variant="h1">
            {employee.firstName} {employee.lastName}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.5 }}>
            <Typography color="text.secondary">
              {he.employees.card.employeeNumber(employee.employeeNumber)}
            </Typography>
            {!employee.isActive && <ActiveMark isActive={false} />}
          </Box>
        </Box>
        <Box sx={{ flex: 1 }} />
        {/* Only hides the button: the API refuses officers and inactive employees anyway. */}
        {role === 'manager' && employee.isActive && (
          <Button
            variant="contained"
            startIcon={<SendOutlined />}
            onClick={() => void navigate('/rounds/new', { state: { employeeId: employee.id } })}
          >
            {he.employees.card.sendDocument}
          </Button>
        )}
        {role === 'manager' && (
          <Button
            variant="outlined"
            component={RouterLink}
            to={`/employees/${employee.id}/edit`}
            startIcon={<EditOutlined />}
          >
            {he.employees.edit}
          </Button>
        )}
      </Box>
      <Box sx={{ display: 'grid', gap: 5 }}>
        <Details card={employee} />
        <EmployeeHistory employeeId={employee.id} />
      </Box>
    </>
  );
}
