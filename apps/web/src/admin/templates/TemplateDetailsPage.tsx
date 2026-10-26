import { formatDate, type TemplateItem } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { z } from 'zod';
import { errorContent } from '../../components/feedback/error-content';
import { ErrorState } from '../../components/feedback/ErrorState';
import { PageLoader } from '../../components/feedback/PageLoader';
import { he } from '../../i18n/he';
import { TemplateArchive } from './TemplateArchive';
import { TemplatePositions } from './TemplatePositions';
import { TemplatePreview } from './TemplatePreview';
import { TemplateSettingsForm } from './TemplateSettingsForm';
import { TemplateStateChips } from './TemplateStateChips';
import { TemplateVersions } from './TemplateVersions';
import { isEditable, reasonLines, reasonText, versionChain } from './template-view';
import { fetchAllTemplateVersions, fetchTemplate, templateKeys } from './templates.api';

const text = he.templates.details;

/** Ready, or every reason it isn't (FR-TPL-8), in our own Hebrew by code. */
function ReadyStatus({ item }: { item: TemplateItem }) {
  const reasons = reasonLines(item);
  return (
    <Paper variant="outlined" component="section" aria-labelledby="template-status" sx={{ p: 3 }}>
      <Typography id="template-status" variant="h2" sx={{ mb: 2 }}>
        {text.statusTitle}
      </Typography>
      {reasons.length === 0 ? (
        <Typography>{text.ready}</Typography>
      ) : (
        <>
          <Typography>{text.notReady}</Typography>
          <Box component="ul" sx={{ m: 0, mt: 1, ps: 2.5 }}>
            {reasons.map((line) => (
              <li key={line.code}>{reasonText(line)}</li>
            ))}
          </Box>
        </>
      )}
    </Paper>
  );
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/**
 * One template version (A9), managers only: its state and "ready" reasons, the settings (name,
 * departments, employer signature), the positions, the sample preview, every version, archive.
 */
export function TemplateDetailsPage() {
  const { templateId = '' } = useParams();
  const validId = isUuid(templateId);
  const template = useQuery({
    queryKey: templateKeys.item(templateId),
    queryFn: ({ signal }) => fetchTemplate(templateId, signal),
    enabled: validId,
  });
  const versions = useQuery({
    queryKey: templateKeys.versions,
    queryFn: ({ signal }) => fetchAllTemplateVersions(signal),
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

  const item = template.data;
  const chain = versions.data ? versionChain(versions.data, item.id) : undefined;
  const newest = chain?.[0];
  const latestId = newest && newest.id !== item.id ? newest.id : null;

  return (
    <>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h1">{item.name}</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mt: 1 }}>
          <Typography color="text.secondary">
            {[
              he.templates.version(item.version),
              text.pageCount(item.pageCount),
              text.createdAt(formatDate(item.createdAt)),
            ].join(' · ')}
          </Typography>
          <TemplateStateChips item={item} />
        </Box>
      </Box>
      <Box sx={{ display: 'grid', gap: 4, maxWidth: 1100 }}>
        <ReadyStatus item={item} />
        {/* Keyed by version and save time, so the form starts from what is stored now. */}
        <TemplateSettingsForm
          key={`${item.id}-${item.updatedAt}`}
          item={item}
          latestId={latestId}
        />
        <TemplatePositions
          fields={item.fields}
          editPath={isEditable(item) ? `/templates/${item.id}/positions` : null}
        />
        <TemplatePreview item={item} />
        <TemplateVersions
          currentId={item.id}
          versions={chain}
          isLoading={versions.isPending}
          error={versions.error}
          onRetry={() => void versions.refetch()}
        />
        {!item.isArchived && <TemplateArchive item={item} />}
      </Box>
    </>
  );
}
