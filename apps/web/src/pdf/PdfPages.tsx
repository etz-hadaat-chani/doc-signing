import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { LoadedPdf } from './pdf-document';
import { scaleToFit } from './page-fit';
import { PdfPageCanvas } from './PdfPageCanvas';

interface PdfPagesProps {
  pdf: LoadedPdf;
  /** The width available (`useWidth`); each page is fitted to it. */
  width: number;
  /** The Hebrew caption under a page, e.g. "page 1 of 3". */
  pageLabel: (number: number, count: number) => string;
}

/**
 * Every page of a PDF drawn by pdf.js, page under page, each box at its fitted size before its
 * canvas draws (the layout is final at once). The page itself is physical (left to right); the
 * captions are Hebrew.
 */
export function PdfPages({ pdf, width, pageLabel }: PdfPagesProps) {
  return pdf.pages.map((size, index) => {
    const scale = scaleToFit(size.width, width);
    return (
      <Box component="figure" key={index} sx={{ m: 0 }}>
        <Box
          sx={{
            width: size.width * scale,
            height: size.height * scale,
            bgcolor: 'common.white',
            boxShadow: 1,
            // The page edge on a white card too (outside the box: its size stays the page's).
            outline: 1,
            outlineColor: 'divider',
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
          {pageLabel(index + 1, pdf.pages.length)}
        </Typography>
      </Box>
    );
  });
}
