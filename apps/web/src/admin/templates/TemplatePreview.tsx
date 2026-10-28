import { TEMPLATE_PREVIEW_WARNINGS, type TemplateItem } from '@doc-signing/shared';
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { errorContent } from '../../components/feedback/error-content';
import { ErrorState } from '../../components/feedback/ErrorState';
import { PageLoader } from '../../components/feedback/PageLoader';
import { he } from '../../i18n/he';
import { boxName } from './template-view';
import { fetchPreviewCheck, previewPath, templateKeys } from './templates.api';

const text = he.templates.details;

function NameList({ title, names }: { title: string; names: readonly string[] }) {
  if (names.length === 0) return null;
  return (
    <Box>
      <Typography sx={{ fontWeight: 'medium' }}>{title}</Typography>
      <Box component="ul" sx={{ m: 0, ps: 2.5 }}>
        {names.map((name, index) => (
          // Two boxes may share a name; the order never changes.
          <li key={`${String(index)}-${name}`}>{name}</li>
        ))}
      </Box>
    </Box>
  );
}

/**
 * The preview with the made-up sample employee (FR-TPL-3): the PDF in a new tab, and what the
 * same preview found (field names only, never values). Warnings by code, in our own Hebrew.
 */
export function TemplatePreview({ item }: { item: TemplateItem }) {
  const check = useQuery({
    queryKey: templateKeys.check(item.id),
    queryFn: ({ signal }) => fetchPreviewCheck(item.id, signal),
    // Each fetch is an audit row (`template.preview_checked`): never again on window focus, only
    // after a change invalidates the template queries.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  let report;
  if (check.isPending) {
    report = <PageLoader />;
  } else if (!check.data) {
    report = (
      <ErrorState
        {...errorContent(check.error)}
        headingComponent="h3"
        onRetry={() => void check.refetch()}
      />
    );
  } else {
    const { missing, leftForEmployee, warnings } = check.data;
    const warningLines: string[] = [];
    for (const { code, keys } of warnings) {
      const message = TEMPLATE_PREVIEW_WARNINGS[code];
      // The API sends "not ready" once per reason; the reasons are listed under the status.
      if (code === 'TEMPLATE_NOT_READY') {
        if (!warningLines.includes(message)) warningLines.push(message);
        continue;
      }
      const boxes = keys.map((key) => boxName(item.fields, key));
      warningLines.push(
        boxes.length === 0 ? message : `${message} ${he.templates.reasonKeys(boxes.join(', '))}`,
      );
    }
    const clean = missing.length + leftForEmployee.length + warnings.length === 0;
    report = (
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        <Typography component="h3" variant="h3">
          {text.checkTitle}
        </Typography>
        {clean && <Typography>{text.checkClean}</Typography>}
        <NameList title={text.missing} names={missing.map(({ name }) => name)} />
        <NameList title={text.leftForEmployee} names={leftForEmployee.map(({ name }) => name)} />
        <NameList title={text.warnings} names={warningLines} />
      </Box>
    );
  }

  return (
    <Paper variant="outlined" component="section" aria-labelledby="template-preview" sx={{ p: 3 }}>
      <Typography id="template-preview" variant="h2" sx={{ mb: 1 }}>
        {text.previewTitle}
      </Typography>
      <Typography sx={{ mb: 2 }}>{text.previewIntro}</Typography>
      <Button
        variant="outlined"
        href={previewPath(item.id)}
        target="_blank"
        rel="noreferrer"
        startIcon={<OpenInNewOutlined />}
        sx={{ mb: 3 }}
      >
        {text.openPreview}
      </Button>
      {report}
    </Paper>
  );
}
