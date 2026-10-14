import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  mixin,
  type NestInterceptor,
  type Type,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer from 'multer';
import type { Observable } from 'rxjs';
import { AppException } from '../errors/app.exception.js';

/** The uploaded file as the handler gets it (`request.file`), held in memory. */
export type UploadedFileData = Express.Multer.File;

/** Text fields next to the file: a repeated field counts each time (e.g. one per department). */
const MAX_TEXT_FIELDS = 600;
/** Each text value at most 64 KB. */
const MAX_TEXT_FIELD_BYTES = 64 * 1024;

/** `defParamCharset` exists in multer 2 but not yet in @types/multer. */
type MulterOptions = multer.Options & { defParamCharset: string };

/** Every failure while reading the upload is the client's broken request: 400, never 500. */
function toAppException(error: unknown): AppException {
  if (!(error instanceof multer.MulterError)) {
    // busboy: malformed multipart ("Unexpected end of form", no boundary, ...).
    return new AppException('BAD_REQUEST', HttpStatus.BAD_REQUEST);
  }
  if (error.code === 'LIMIT_FILE_SIZE') {
    return new AppException('FILE_TOO_LARGE', HttpStatus.BAD_REQUEST);
  }
  if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
    return new AppException('FILE_REQUIRED', HttpStatus.BAD_REQUEST);
  }
  return new AppException('BAD_REQUEST', HttpStatus.BAD_REQUEST);
}

/**
 * Reads one multipart file from form field `field` into memory (NFR-SEC-9), with a size cap. Text
 * fields are refused unless `withTextFields` is true; then they land in `request.body` (as text,
 * a repeated field as an array) for the route to validate with its zod schema. A file over
 * `maxBytes` → 400 FILE_TOO_LARGE; no file, two files or a different field → 400 FILE_REQUIRED;
 * any other broken upload → 400 BAD_REQUEST. File names are read as UTF-8, so Hebrew names arrive
 * intact. Guards run before interceptors, so a caller without access gets 401/403 before the
 * upload is read. The handler takes the file with `@UploadedFile()`. Checking what the bytes are
 * is the caller's job (e.g. checkXlsxContent, readPdfContent).
 */
export function SingleFileUpload(
  field: string,
  maxBytes: number,
  { withTextFields = false }: { withTextFields?: boolean } = {},
): Type<NestInterceptor> {
  const fields = withTextFields ? MAX_TEXT_FIELDS : 0;
  const options: MulterOptions = {
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxBytes,
      files: 1,
      fields,
      fieldSize: MAX_TEXT_FIELD_BYTES,
      parts: fields + 1,
    },
    defParamCharset: 'utf8',
  };
  const upload = multer(options).single(field);

  class SingleFileUploadInterceptor implements NestInterceptor {
    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
      const http = context.switchToHttp();
      const request = http.getRequest<Request>();
      await new Promise<void>((resolve, reject) => {
        upload(request, http.getResponse<Response>(), (error: unknown) => {
          if (error) reject(toAppException(error));
          else resolve();
        });
      });
      if (!request.file) throw new AppException('FILE_REQUIRED', HttpStatus.BAD_REQUEST);
      return next.handle();
    }
  }
  return mixin(SingleFileUploadInterceptor);
}
