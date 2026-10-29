import {
  type TemplateFieldInput,
  type TemplateItem,
  TEMPLATE_NOT_READY_MESSAGES,
  type TemplateNotReadyReason,
  type TemplateUpdateInput,
} from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { isApiRequestError } from '../../../api/api-error';
import { ConfirmDialog } from '../../../components/dialogs/ConfirmDialog';
import { errorContent } from '../../../components/feedback/error-content';
import { ErrorState } from '../../../components/feedback/ErrorState';
import { PageLoader } from '../../../components/feedback/PageLoader';
import { useNotify } from '../../../components/notifications/notify-context';
import { he } from '../../../i18n/he';
import { TemplatePreview } from '../TemplatePreview';
import { TemplateStateChips } from '../TemplateStateChips';
import { boxName, isEditable } from '../template-view';
import { fetchPreviewPdf, fetchTemplate, templateKeys, updateTemplate } from '../templates.api';
import { AddBoxMenu } from './AddBoxMenu';
import { BoxCard } from './BoxCard';
import {
  boxCardId,
  checkEditor,
  type EditorErrors,
  errorFieldIds,
  hasErrors,
  noErrors,
  serverEditorErrors,
} from './editor-check';
import { boxTitle } from './editor-rules';
import {
  addBox,
  type EditorState,
  isPension,
  readNumber,
  sameAsStored,
  setPensionSource,
  stateFromFields,
} from './editor-state';
import { inFooter } from './pdf-geometry';
import { type Outline, PdfPositionsView } from './PdfPositionsView';
import { usePdf } from '../../../pdf/use-pdf';
import { useUnsavedGuard } from './use-unsaved-guard';

const text = he.templates.editor;
const details = he.templates.details;
const PENSION_SOURCES = ['a_then_b', 'b_only'] as const;
/** Someone else changed or archived this version first: show it again from the server. */
const CONFLICT_CODES = new Set(['TEMPLATE_HAS_NEWER_VERSION', 'TEMPLATE_ARCHIVED']);

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/** The live "ready" check on the unsaved list (FR-TPL-8), boxes named in Hebrew. */
function LiveReadiness({
  reasons,
  fields,
}: {
  reasons: TemplateNotReadyReason[] | null;
  fields: readonly TemplateFieldInput[] | null;
}) {
  let body;
  if (reasons === null || fields === null) {
    body = <Alert severity="info">{text.fixErrorsFirst}</Alert>;
  } else if (reasons.length === 0) {
    body = <Alert severity="success">{text.readyLive}</Alert>;
  } else {
    body = (
      <Alert severity="warning">
        {text.notReadyLive}
        <Box component="ul" sx={{ m: 0, mt: 0.5, ps: 2.5 }}>
          {reasons.map(({ code, keys }) => {
            const message = TEMPLATE_NOT_READY_MESSAGES[code];
            const boxes = keys.map((key) => boxName(fields, key));
            return (
              <li key={code}>
                {boxes.length === 0
                  ? message
                  : `${message} ${he.templates.reasonKeys(boxes.join(', '))}`}
              </li>
            );
          })}
        </Box>
      </Alert>
    );
  }
  return (
    <Box component="section" aria-labelledby="live-readiness" sx={{ display: 'grid', gap: 1 }}>
      <Typography id="live-readiness" variant="h2">
        {text.readinessTitle}
      </Typography>
      <Box aria-live="polite">{body}</Box>
    </Box>
  );
}

/** Where every position is now, for the outlines; numbers that can't be read are left out. */
function outlinesOf(state: EditorState): Outline[] {
  const byUid = new Map(state.boxes.map((box) => [box.uid, box]));
  return state.positions.flatMap((position) => {
    const box = byUid.get(position.boxUid);
    const [page, x, y, width, height] = [
      position.page,
      position.x,
      position.y,
      position.width,
      position.height,
    ].map(readNumber);
    if (
      !box ||
      [page, x, y, width, height].some((value) => value === undefined || Number.isNaN(value))
    ) {
      return [];
    }
    return [
      {
        uid: position.uid,
        boxUid: box.uid,
        page: page ?? 0,
        x: x ?? 0,
        y: y ?? 0,
        width: width ?? 0,
        height: height ?? 0,
        name: boxTitle(box),
        inFooter: inFooter(y ?? 0),
      },
    ];
  });
}

function PositionsEditor({ item }: { item: TemplateItem }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const editable = isEditable(item);
  const [initial] = useState(() => stateFromFields(item.fields));
  const [state, setState] = useState<EditorState>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<EditorErrors | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [confirmVersion, setConfirmVersion] = useState<TemplateUpdateInput | null>(null);

  const previewPdf = useQuery({
    queryKey: templateKeys.previewPdf(item.id),
    queryFn: ({ signal }) => fetchPreviewPdf(item.id, signal),
    // Each fetch logs a view (`template.previewed`) and redraws the PDF: fetched once, and again
    // only after a save invalidates it, never on window focus.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const pdfState = usePdf(previewPdf.data);
  const pages = pdfState.status === 'ready' ? pdfState.pdf.pages : null;
  const check = useMemo(() => checkEditor(state, item, { pages }), [state, item, pages]);
  const outlines = useMemo(() => outlinesOf(state), [state]);

  const dirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(initial), [state, initial]);
  const { blocker, allowLeave } = useUnsavedGuard(dirty && editable);
  const save = useMutation({
    mutationFn: (input: TemplateUpdateInput) => updateTemplate(item.id, input),
  });

  const shownErrors = serverErrors ?? (showErrors ? check.errors : noErrors());

  const onState = (update: (current: EditorState) => EditorState) => {
    setServerErrors(null);
    setState(update);
  };

  const focusFirst = (errors: EditorErrors) => {
    const [first] = errorFieldIds(errors, state);
    if (first) document.getElementById(first)?.focus();
  };

  const selectBox = (uid: string) => {
    setSelected(uid);
    const heading = document.getElementById(boxCardId(uid));
    heading?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    heading?.focus({ preventScroll: true });
  };

  const send = async (input: TemplateUpdateInput) => {
    try {
      const saved = await save.mutateAsync(input);
      setConfirmVersion(null);
      allowLeave();
      if (saved.id !== item.id) {
        notify.success(details.versionCreated(saved.version));
        await queryClient.invalidateQueries({ queryKey: templateKeys.all });
        await navigate(`/templates/${saved.id}/positions`);
      } else {
        notify.success(text.saved);
        // The item comes back with a new save time: the editor starts again from it.
        await queryClient.invalidateQueries({ queryKey: templateKeys.all });
      }
    } catch (error) {
      setConfirmVersion(null);
      const found = serverEditorErrors(error, state);
      if (found) {
        setServerErrors(found);
        focusFirst(found);
      } else if (isApiRequestError(error) && error.code && CONFLICT_CODES.has(error.code)) {
        setConflict(error.message);
        await queryClient.invalidateQueries({ queryKey: templateKeys.all });
      } else {
        notify.error(errorContent(error).message);
      }
    }
  };

  const handleSave = () => {
    if (save.isPending || !editable) return;
    setShowErrors(true);
    if (!check.fields) {
      notify.error(text.fixFields);
      focusFirst(check.errors);
      return;
    }
    if (sameAsStored(check.fields, item.fields)) {
      notify.success(details.noChanges);
      return;
    }
    const input: TemplateUpdateInput = { fields: check.fields };
    if (item.isLocked) setConfirmVersion(input);
    else void send(input);
  };

  const hasPension = state.boxes.some(({ fieldType }) => isPension(fieldType));

  return (
    <>
      <Box sx={{ mb: 3, display: 'grid', gap: 1 }}>
        <Typography variant="h1">{text.title}</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
          <Typography color="text.secondary">
            {`${item.name} · ${he.templates.version(item.version)}`}
          </Typography>
          <TemplateStateChips item={item} />
        </Box>
        <Box>
          <Link component={RouterLink} to={`/templates/${item.id}`}>
            {text.backToDetails}
          </Link>
        </Box>
        <Typography sx={{ maxWidth: 900 }}>{text.intro}</Typography>
      </Box>

      <Box sx={{ display: 'grid', gap: 2, mb: 3 }}>
        {!editable && (
          <Alert severity="info" role="note">
            {text.readOnly} {item.isArchived ? details.readOnlyArchived : details.readOnlyOld}
          </Alert>
        )}
        {editable && item.isLocked && (
          <Alert severity="warning" role="note">
            {details.lockedNote}
          </Alert>
        )}
        {conflict && (
          <Alert severity="error" role="alert">
            {conflict}
          </Alert>
        )}
        {shownErrors.general && (
          <Alert severity="error" role="alert">
            {shownErrors.general}
          </Alert>
        )}
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 4,
          alignItems: 'start',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(440px, 1fr) minmax(0, 1.15fr)' },
        }}
      >
        <Box sx={{ display: 'grid', gap: 2.5, minWidth: 0 }}>
          <LiveReadiness reasons={check.readiness} fields={check.parsed} />
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1.5,
              position: 'sticky',
              top: 0,
              zIndex: 3,
              bgcolor: 'background.default',
              py: 1,
            }}
          >
            <Typography id="boxes-title" variant="h2" sx={{ flex: 1 }}>
              {text.boxesTitle}
            </Typography>
            {editable && (
              <>
                {dirty && (
                  <Typography variant="body2" color="text.secondary">
                    {text.unsaved}
                  </Typography>
                )}
                <AddBoxMenu
                  disabled={save.isPending}
                  onAdd={(type) => {
                    const added = addBox(state, type);
                    onState(() => added.state);
                    setSelected(added.boxUid);
                  }}
                />
                <Button variant="contained" onClick={handleSave} disabled={save.isPending}>
                  {save.isPending ? text.saving : text.save}
                </Button>
              </>
            )}
          </Box>
          {hasPension && (
            <Paper
              variant="outlined"
              sx={{ p: 2.5 }}
              component="section"
              aria-labelledby="pension-source"
            >
              <FormLabel
                id="pension-source"
                component="h3"
                sx={{ fontWeight: 'medium', color: 'text.primary' }}
              >
                {text.pensionTitle}
              </FormLabel>
              <Typography variant="body2" color="text.secondary">
                {text.pensionHint}
              </Typography>
              <RadioGroup
                aria-labelledby="pension-source"
                value={state.pensionSource}
                onChange={(event) => {
                  const source = PENSION_SOURCES.find((item) => item === event.target.value);
                  if (source) onState((current) => setPensionSource(current, source));
                }}
              >
                {PENSION_SOURCES.map((source) => (
                  <FormControlLabel
                    key={source}
                    value={source}
                    disabled={!editable}
                    control={<Radio />}
                    label={text.pensionSources[source]}
                  />
                ))}
              </RadioGroup>
            </Paper>
          )}
          {state.boxes.length === 0 && <Typography>{text.noBoxes}</Typography>}
          {state.boxes.map((box) => (
            <BoxCard
              key={box.uid}
              box={box}
              state={state}
              errors={shownErrors}
              inFooter={check.inFooter}
              selected={box.uid === selected}
              disabled={!editable || save.isPending}
              onState={onState}
              onSelect={() => setSelected(box.uid)}
            />
          ))}
          {showErrors && hasErrors(shownErrors) && <Alert severity="error">{text.fixFields}</Alert>}
        </Box>

        <Box
          component="section"
          aria-labelledby="pdf-title"
          sx={{
            display: 'grid',
            gap: 2,
            minWidth: 0,
            position: { lg: 'sticky' },
            top: { lg: 16 },
            maxHeight: { lg: 'calc(100vh - 32px)' },
            overflowY: { lg: 'auto' },
          }}
        >
          <Typography id="pdf-title" variant="h2">
            {text.previewTitle}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {text.previewIntro}
          </Typography>
          {previewPdf.isError ? (
            <ErrorState
              {...errorContent(previewPdf.error)}
              headingComponent="h3"
              onRetry={() => void previewPdf.refetch()}
            />
          ) : (
            <PdfPositionsView
              pdfState={pdfState}
              outlines={outlines}
              selectedBoxUid={selected}
              onSelect={selectBox}
            />
          )}
          <TemplatePreview item={item} />
        </Box>
      </Box>

      <ConfirmDialog
        open={confirmVersion !== null}
        title={details.versionDialogTitle}
        text={details.versionDialogText(item.version, item.version + 1)}
        confirmLabel={details.versionDialogConfirm}
        busy={save.isPending}
        onConfirm={() => {
          if (confirmVersion && !save.isPending) void send(confirmVersion);
        }}
        onClose={() => setConfirmVersion(null)}
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title={text.leaveTitle}
        text={text.leaveText}
        confirmLabel={text.leaveConfirm}
        cancelLabel={text.stay}
        danger
        onConfirm={() => blocker.proceed?.()}
        onClose={() => blocker.reset?.()}
      />
    </>
  );
}

/**
 * The position editor (A9, 5.4 part B), managers only: one card per box with its settings and
 * positions, the preview PDF with every unsaved position outlined, the live "ready" check.
 */
export function TemplatePositionsPage() {
  const { templateId = '' } = useParams();
  const validId = isUuid(templateId);
  const template = useQuery({
    queryKey: templateKeys.item(templateId),
    queryFn: ({ signal }) => fetchTemplate(templateId, signal),
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
  if (template.isPending) return <PageLoader />;
  if (!template.data) {
    return <ErrorState {...errorContent(template.error)} onRetry={() => void template.refetch()} />;
  }
  // Keyed by version and save time, so the editor starts from what is stored now.
  const item = template.data;
  return <PositionsEditor key={`${item.id}-${item.updatedAt}`} item={item} />;
}
