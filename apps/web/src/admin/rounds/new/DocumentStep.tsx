import type { RoundMode, TemplateItem } from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router';
import { errorContent } from '../../../components/feedback/error-content';
import { ErrorState } from '../../../components/feedback/ErrorState';
import { PageLoader } from '../../../components/feedback/PageLoader';
import { he } from '../../../i18n/he';
import { tokens } from '../../../theme/tokens';
import { departmentLabels, reasonLines, reasonText } from '../../templates/template-view';
import { TemplateStateChips } from '../../templates/TemplateStateChips';
import { fetchActiveTemplates, templateKeys } from '../../templates/templates.api';
import { problemText } from './problem-text';
import type { StepProblem } from './wizard-state';

const texts = he.newRound.document;

function TemplateOption({ item, checked }: { item: TemplateItem; checked: boolean }) {
  const labelId = `template-${item.id}`;
  const departments = departmentLabels(item);
  return (
    <Paper
      component="label"
      variant="outlined"
      sx={{
        display: 'flex',
        gap: 1,
        p: 2,
        cursor: item.isReady ? 'pointer' : 'default',
        borderColor: checked ? 'primary.main' : undefined,
      }}
    >
      <Radio
        value={item.id}
        disabled={!item.isReady}
        slotProps={{ input: { 'aria-labelledby': labelId } }}
        sx={{ alignSelf: 'flex-start', mt: -1 }}
      />
      <Box sx={{ display: 'grid', gap: 0.5, minWidth: 0 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          <Typography
            id={labelId}
            component="span"
            sx={{ fontWeight: tokens.font.weight.semibold }}
          >
            <bdi>{item.name}</bdi> · {texts.version(item.version)}
          </Typography>
          <TemplateStateChips item={item} />
        </Box>
        <Typography variant="body2" color="text.secondary">
          {departments.length === 0
            ? texts.noDepartments
            : texts.departments(departments.join(', '))}
        </Typography>
        {!item.isReady && (
          <Box component="ul" sx={{ m: 0, paddingInlineStart: 3 }}>
            {reasonLines(item).map((line) => (
              <Typography component="li" variant="body2" key={line.code}>
                {reasonText(line)}
              </Typography>
            ))}
          </Box>
        )}
      </Box>
    </Paper>
  );
}

/**
 * Step 2: the document. One template for everyone: every active template, all pages, a ready one
 * can be chosen. By department: each department's own template, settled in the summary.
 */
export function DocumentStep({
  mode,
  templateId,
  problem,
  onTemplate,
}: {
  mode: RoundMode;
  templateId: string | null;
  problem: StepProblem | null;
  onTemplate: (templateId: string) => void;
}) {
  const templates = useQuery({
    queryKey: templateKeys.active,
    queryFn: ({ signal }) => fetchActiveTemplates(signal),
    enabled: mode === 'single_template',
  });

  if (mode === 'by_department') {
    return (
      <Alert severity="info" role="note">
        {texts.byDepartment}
      </Alert>
    );
  }
  if (templates.isPending) return <PageLoader />;
  if (!templates.data) {
    return (
      <ErrorState
        {...errorContent(templates.error)}
        headingComponent="h3"
        onRetry={() => void templates.refetch()}
      />
    );
  }
  if (templates.data.length === 0) {
    return (
      <Typography>
        {texts.none}{' '}
        <Link component={RouterLink} to="/templates">
          {texts.toTemplates}
        </Link>
      </Typography>
    );
  }

  return (
    <FormControl error={problem !== null}>
      <FormLabel id="round-template-label" sx={{ mb: 1 }}>
        {texts.label}
      </FormLabel>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {texts.intro}
      </Typography>
      <RadioGroup
        aria-labelledby="round-template-label"
        value={templateId ?? ''}
        onChange={(_event, value) => onTemplate(value)}
        sx={{ display: 'grid', gap: 1.5 }}
      >
        {templates.data.map((item) => (
          <TemplateOption key={item.id} item={item} checked={item.id === templateId} />
        ))}
      </RadioGroup>
      {problem !== null && <FormHelperText>{problemText(problem)}</FormHelperText>}
    </FormControl>
  );
}
