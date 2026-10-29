import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import { PageLoader } from '../../../components/feedback/PageLoader';
import { he } from '../../../i18n/he';
import { PdfPages } from '../../../pdf/PdfPages';
import type { PdfState } from '../../../pdf/use-pdf';
import { useWidth } from '../../../pdf/use-width';

const texts = he.newRound.preview;

/**
 * A whole PDF drawn by pdf.js, page under page, as wide as the area. Left to right (a PDF page is
 * physical); the page captions are Hebrew. No outlines: this is the document as sent.
 */
export function PdfDocumentView({ pdfState, failed }: { pdfState: PdfState; failed: boolean }) {
  const { ref, width } = useWidth();
  let content;
  if (failed || pdfState.status === 'error') {
    content = (
      <Alert severity="error" dir="rtl">
        {texts.pdfFailed}
      </Alert>
    );
  } else if (pdfState.status !== 'ready') {
    content = <PageLoader />;
  } else {
    content = <PdfPages pdf={pdfState.pdf} width={width} pageLabel={texts.pageLabel} />;
  }
  return (
    <Box
      ref={ref}
      dir="ltr"
      role="region"
      aria-label={texts.documentLabel}
      data-testid="round-pdf-area"
      sx={{ width: '100%', maxWidth: 900 }}
    >
      {content}
    </Box>
  );
}
