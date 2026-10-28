import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import { alpha } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { PageLoader } from '../../../components/feedback/PageLoader';
import { he } from '../../../i18n/he';
import type { LoadedPdf } from './pdf-document';
import { footerRect, type PageSize, type PointBox, scaleToFit, toPixels } from './pdf-geometry';
import { PdfPageCanvas } from './PdfPageCanvas';
import type { PdfState } from './use-pdf';
import { useWidth } from './use-width';

const text = he.templates.editor;

/** One outline: where an unsaved position is now, with its box's Hebrew name. */
export interface Outline extends PointBox {
  uid: string;
  boxUid: string;
  page: number;
  name: string;
  inFooter: boolean;
}

function PdfPage({
  pdf,
  size,
  number,
  scale,
  outlines,
  selectedBoxUid,
  onSelect,
}: {
  pdf: LoadedPdf;
  size: PageSize;
  number: number;
  scale: number;
  outlines: readonly Outline[];
  selectedBoxUid: string | null;
  onSelect: (boxUid: string) => void;
}) {
  const footer = footerRect(size, scale);
  return (
    <Box component="figure" sx={{ m: 0 }}>
      <Box
        sx={{
          position: 'relative',
          width: size.width * scale,
          height: size.height * scale,
          bgcolor: 'common.white',
          boxShadow: 1,
        }}
      >
        <PdfPageCanvas pdf={pdf} number={number} scale={scale} />
        <Box
          aria-hidden="true"
          sx={(theme) => ({
            position: 'absolute',
            ...footer,
            bgcolor: alpha(theme.palette.warning.main, 0.18),
            borderTop: `1px dashed ${theme.palette.warning.dark}`,
            pointerEvents: 'none',
          })}
        />
        {outlines.map((outline) => {
          const rect = toPixels(outline, size, scale);
          const selected = outline.boxUid === selectedBoxUid;
          return (
            <Box
              key={outline.uid}
              component="button"
              type="button"
              data-outline={outline.uid}
              aria-label={text.selectBox(outline.name)}
              onClick={() => onSelect(outline.boxUid)}
              // Inline, not a class: it changes on every keystroke.
              style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
              sx={(theme) => {
                const color = outline.inFooter
                  ? theme.palette.error.main
                  : theme.palette.primary.main;
                return {
                  position: 'absolute',
                  p: 0,
                  m: 0,
                  cursor: 'pointer',
                  border: `${selected ? 3 : 1.5}px ${selected ? 'solid' : 'dashed'} ${color}`,
                  bgcolor: alpha(color, selected ? 0.16 : 0.06),
                  zIndex: selected ? 2 : 1,
                  '&:focus-visible': { outline: `2px solid ${theme.palette.text.primary}` },
                };
              }}
            >
              <Box
                component="span"
                dir="rtl"
                sx={(theme) => ({
                  position: 'absolute',
                  insetInlineEnd: 0,
                  bottom: '100%',
                  px: 0.5,
                  fontSize: 11,
                  lineHeight: 1.4,
                  whiteSpace: 'nowrap',
                  color: theme.palette.common.white,
                  bgcolor: outline.inFooter ? 'error.main' : 'primary.main',
                  borderRadius: 0.5,
                  pointerEvents: 'none',
                })}
              >
                {outline.name}
              </Box>
            </Box>
          );
        })}
      </Box>
      <Typography
        component="figcaption"
        variant="body2"
        color="text.secondary"
        dir="rtl"
        sx={{ mt: 0.5, mb: 2 }}
      >
        {text.pageLabel(number, pdf.pages.length)}
      </Typography>
    </Box>
  );
}

/**
 * The preview PDF drawn by pdf.js with every unsaved position outlined on top (5.4 part B).
 * The area is left to right: PDF coordinates are physical. The bottom 16 pt strip (the signed
 * PDF's footer line) is shaded. A changed number moves its outline at once, with no request.
 */
export function PdfPositionsView({
  pdfState,
  outlines,
  selectedBoxUid,
  onSelect,
}: {
  pdfState: PdfState;
  outlines: readonly Outline[];
  selectedBoxUid: string | null;
  onSelect: (boxUid: string) => void;
}) {
  const { ref, width } = useWidth();
  let content;
  if (pdfState.status === 'error') {
    content = <Alert severity="error">{text.previewFailed}</Alert>;
  } else if (pdfState.status !== 'ready') {
    content = <PageLoader />;
  } else {
    const { pdf } = pdfState;
    content = pdf.pages.map((size, index) => (
      <PdfPage
        key={index}
        pdf={pdf}
        size={size}
        number={index + 1}
        scale={scaleToFit(size.width, width)}
        outlines={outlines.filter(({ page }) => page === index + 1)}
        selectedBoxUid={selectedBoxUid}
        onSelect={onSelect}
      />
    ));
  }
  return (
    <Box ref={ref} dir="ltr" data-testid="pdf-area" sx={{ width: '100%' }}>
      {content}
    </Box>
  );
}
