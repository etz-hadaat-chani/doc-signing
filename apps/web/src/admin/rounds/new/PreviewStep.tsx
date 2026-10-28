import { TEMPLATE_PREVIEW_WARNINGS, type TemplatePreviewReport } from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PageLoader } from '../../../components/feedback/PageLoader';
import { he } from '../../../i18n/he';
import { usePdf } from '../../templates/editor/use-pdf';
import { fetchPreviewCheck, fetchPreviewPdf, templateKeys } from '../../templates/templates.api';
import { EmailPreview } from './EmailPreview';
import { fullName } from './employee-columns';
import { EmployeePicker } from './EmployeePicker';
import { PdfDocumentView } from './PdfDocumentView';
import {
  type PreviewTemplate,
  previewTemplateId,
  previewTemplates,
  type WizardAction,
  type WizardState,
} from './wizard-state';

const texts = he.newRound.preview;

/** Each call writes an audit row (a document view): asked once per template and employee. */
const ONCE = { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } as const;

function templateLabel(template: PreviewTemplate) {
  const name =
    template.name === null
      ? texts.chosenTemplate
      : he.newRound.summary.templateName(template.name, template.version ?? 1);
  return texts.templateOption(name, template.departments.join(', '));
}

function CheckReport({ report }: { report: TemplatePreviewReport }) {
  const clean =
    report.missing.length === 0 &&
    report.leftForEmployee.length === 0 &&
    report.warnings.length === 0;
  if (clean) return <Alert severity="success">{texts.noIssues}</Alert>;
  return (
    <>
      {report.warnings.length > 0 && (
        <Alert severity="warning" role="note" data-testid="preview-warnings">
          <Box component="ul" sx={{ m: 0, paddingInlineStart: 3 }}>
            {report.warnings.map((warning) => (
              <li key={warning.code}>{TEMPLATE_PREVIEW_WARNINGS[warning.code]}</li>
            ))}
          </Box>
        </Alert>
      )}
      {report.missing.length > 0 && (
        <Alert severity="warning" role="note">
          <AlertTitle>{texts.missingTitle}</AlertTitle>
          {report.missing.map(({ name }) => name).join(', ')}
        </Alert>
      )}
      {report.leftForEmployee.length > 0 && (
        <Alert severity="info" role="note">
          <AlertTitle>{texts.leftTitle}</AlertTitle>
          {report.leftForEmployee.map(({ name }) => name).join(', ')}
        </Alert>
      )}
    </>
  );
}

function DocumentPreview({
  templateId,
  employeeId,
}: {
  templateId: string;
  employeeId: string | null;
}) {
  const pdf = useQuery({
    queryKey: templateKeys.previewPdf(templateId, employeeId),
    queryFn: ({ signal }) => fetchPreviewPdf(templateId, signal, employeeId),
    ...ONCE,
  });
  const check = useQuery({
    queryKey: templateKeys.check(templateId, employeeId),
    queryFn: ({ signal }) => fetchPreviewCheck(templateId, signal, employeeId),
    ...ONCE,
  });
  const pdfState = usePdf(pdf.data);

  return (
    <>
      <Box component="section" aria-labelledby="round-check-title" sx={{ display: 'grid', gap: 2 }}>
        <Typography variant="h3" id="round-check-title">
          {texts.checkTitle}
        </Typography>
        {check.isError ? (
          <Alert severity="error">{texts.checkFailed}</Alert>
        ) : check.data ? (
          <CheckReport report={check.data} />
        ) : (
          <PageLoader />
        )}
      </Box>
      <Box
        component="section"
        aria-labelledby="round-document-title"
        sx={{ display: 'grid', gap: 2 }}
      >
        <Typography variant="h3" id="round-document-title">
          {texts.documentTitle}
        </Typography>
        <PdfDocumentView pdfState={pdfState} failed={pdf.isError} />
      </Box>
    </>
  );
}

/**
 * Step 6 (Flow 3): the document as the employee gets it, for the made-up sample or one picked
 * employee (the ID number appears only inside the PDF), what the preview found, and the
 * invitation email. Nothing is stored or sent; the PDF and check are asked once each.
 */
export function PreviewStep({
  state,
  linkExpiryDays,
  dispatch,
}: {
  state: WizardState;
  linkExpiryDays: number;
  dispatch: (action: WizardAction) => void;
}) {
  const templates = previewTemplates(state);
  const templateId = previewTemplateId(state);
  const employee = state.previewPick.employee;
  const [specific, setSpecific] = useState(employee !== null);
  if (templateId === null) return null;
  const current = templates.find(({ id }) => id === templateId);

  return (
    <>
      <Typography color="text.secondary">{texts.intro}</Typography>
      {templates.length > 1 ? (
        <TextField
          select
          label={texts.templateLabel}
          value={templateId}
          onChange={(event) =>
            dispatch({ type: 'previewTemplate', templateId: event.target.value })
          }
          sx={{ maxWidth: 520 }}
        >
          {templates.map((template) => (
            <MenuItem key={template.id} value={template.id}>
              {templateLabel(template)}
            </MenuItem>
          ))}
        </TextField>
      ) : (
        current && (
          <Typography>
            <bdi>{templateLabel(current)}</bdi>
          </Typography>
        )
      )}

      <FormControl>
        <FormLabel id="round-preview-employee">{texts.employeeLabel}</FormLabel>
        <RadioGroup
          aria-labelledby="round-preview-employee"
          value={specific ? 'specific' : 'sample'}
          onChange={(_event, value) => {
            setSpecific(value === 'specific');
            if (value === 'sample') dispatch({ type: 'previewEmployee', employee: null });
          }}
        >
          <FormControlLabel value="sample" control={<Radio />} label={texts.sample} />
          <FormControlLabel value="specific" control={<Radio />} label={texts.specific} />
        </RadioGroup>
      </FormControl>
      {specific && (
        <EmployeePicker
          single
          canPick
          isPicked={(id) => id === employee?.id}
          onPick={(picked) => dispatch({ type: 'previewEmployee', employee: picked })}
        />
      )}
      {employee !== null && (
        <Typography sx={{ fontWeight: 700 }}>{texts.showingFor(fullName(employee))}</Typography>
      )}

      <DocumentPreview templateId={templateId} employeeId={employee?.id ?? null} />
      <EmailPreview templateId={templateId} linkExpiryDays={linkExpiryDays} />
    </>
  );
}
