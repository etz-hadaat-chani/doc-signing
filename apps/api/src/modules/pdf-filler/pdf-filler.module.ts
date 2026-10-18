import { Module } from '@nestjs/common';
import { PdfAssetsService } from './pdf-assets.service.js';

/**
 * PDF Filler (FR-TPL-2, FR-TPL-9, NFR-HEB-3): the values step (`buildFieldValues`), the drawing
 * step (`renderPersonalizedPdf`, one function per box type in `pdf-boxes.ts`) and the font and
 * file cache they use. Used by the template preview (3.6), the signed PDF (3.7, renderSignedPdf: no
 * database or storage, called by 3.13 and 3.16), the recipient preview (3.8), the send (3.10) and
 * print (3.16).
 */
@Module({
  providers: [PdfAssetsService],
  exports: [PdfAssetsService],
})
export class PdfFillerModule {}
