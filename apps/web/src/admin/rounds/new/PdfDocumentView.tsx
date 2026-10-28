import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { PageLoader } from '../../../components/feedback/PageLoader';
import { he } from '../../../i18n/he';
import { scaleToFit } from '../../templates/editor/pdf-geometry';
import { PdfPageCanvas } from '../../templates/editor/PdfPageCanvas';
import type { PdfState } from '../../templates/editor/use-pdf';
import { useWidth } from '../../templates/editor/use-width';

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
    const { pdf } = pdfState;
    content = pdf.pages.map((size, index) => {
      const scale = scaleToFit(size.width, width);
      return (
        <Box component="figure" key={index} sx={{ m: 0 }}>
          <Box
            sx={{
              width: size.width * scale,
              height: size.height * scale,
              bgcolor: 'common.white',
              boxShadow: 1,
            }}
          >
            <PdfPageCanvas pdf={pdf} number={index + 1} scale={scale} />
          </Box>
          <Typography
            component="figcaption"
            variant="body2"
            color="text.secondary"
            dir="rtl"
            sx={{ mt: 0.5, mb: 2 }}
          >
            {texts.pageLabel(index + 1, pdf.pages.length)}
          </Typography>
        </Box>
      );
    });
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
