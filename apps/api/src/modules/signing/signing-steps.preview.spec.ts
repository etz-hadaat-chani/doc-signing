import type { SignPreviewInput } from '@doc-signing/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import type { PrismaService } from '../../common/prisma/prisma.service.js';
import type { QueueService } from '../../common/queue/queue.service.js';
import type { PdfAssetsService } from '../pdf-filler/pdf-assets.service.js';
import type { RenderSignedInput, SignedPdf } from '../pdf-filler/signed-pdf.js';
import type { TemplatesRepository } from '../templates/templates.repository.js';
import type { KioskRepository } from './kiosk.repository.js';
import type { SignedFilesService } from './signed-files.service.js';
import type { SigningRepository } from './signing.repository.js';
import type { SigningRateLimitService } from './signing-rate-limit.service.js';
import type { SigningSessionService } from './signing-session.service.js';
import { type SigningAccess, SigningStepsService } from './signing-steps.service.js';

const pdfFiller = vi.hoisted(() => ({
  renderSignedPdf: vi.fn<(input: RenderSignedInput) => Promise<Partial<SignedPdf>>>(),
  addPreviewWatermark: vi.fn<(pdf: Uint8Array, font: unknown) => Promise<Uint8Array>>(),
}));
vi.mock('../pdf-filler/signed-pdf.js', () => ({ renderSignedPdf: pdfFiller.renderSignedPdf }));
vi.mock('../pdf-filler/preview-watermark.js', () => ({
  addPreviewWatermark: pdfFiller.addPreviewWatermark,
}));

const ASSIGNMENT_ID = '3f9a1c2b-7d40-4e1a-9b2c-0d1e2f3a4b5c';
const SIGNED_BYTES = new Uint8Array([1, 2, 3]);
const PREVIEW_BYTES = new Uint8Array([4, 5, 6]);
const FONT = { name: 'Heebo' };
const TEMPLATE_BYTES = new Uint8Array([9]);

const access: SigningAccess = {
  channel: 'link',
  assignmentId: ASSIGNMENT_ID,
  roundId: 'b6f0c1aa-0000-4000-8000-000000000001',
  emailMessageId: 'b6f0c1aa-0000-4000-8000-000000000002',
  toEmail: 'nobody@example.test',
};
const client = { ip: '203.0.113.5', userAgent: 'test', sessionToken: 'session' };
const body: SignPreviewInput = {
  signatureImage: 'data:image/png;base64,AAAA',
  emailChoice: 'office',
  answers: { nickname: 'דנה' },
  drawings: {},
};

const signingData = vi.fn();
const repository = {
  signingData,
  lockForSigning: vi.fn(),
  markSigned: vi.fn(),
  insertResponses: vi.fn(),
  deleteSessions: vi.fn(),
  createSignedCopyEmail: vi.fn(),
};
const files = { storeImage: vi.fn(), storePdf: vi.fn() };
const prisma = { $transaction: vi.fn() };
const queue = { sendMany: vi.fn() };
const record = vi.fn();
const assets = {
  font: FONT,
  templatePdf: vi.fn(() => Promise.resolve(TEMPLATE_BYTES)),
  employerSignature: vi.fn(),
};
const templates = {
  find: vi.fn(() =>
    Promise.resolve({
      id: 'b6f0c1aa-0000-4000-8000-000000000003',
      name: 'חוזה לדוגמה',
      fileKey: 'templates/test.pdf',
      employerSignatureMode: 'none',
      fields: [],
    }),
  ),
};

function service() {
  return new SigningStepsService(
    prisma as unknown as PrismaService,
    repository as unknown as SigningRepository,
    {} as KioskRepository,
    {} as SigningRateLimitService,
    {} as SigningSessionService,
    files as unknown as SignedFilesService,
    templates as unknown as TemplatesRepository,
    assets as unknown as PdfAssetsService,
    queue as unknown as QueueService,
    { record } as unknown as AuditService,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: new Date('2026-11-01T10:00:00.400Z'), toFake: ['Date'] });
  signingData.mockResolvedValue({
    assignmentId: ASSIGNMENT_ID,
    roundId: access.roundId,
    templateId: 'b6f0c1aa-0000-4000-8000-000000000003',
    fieldValues: { version: 1, sendDay: '2026-10-01', values: {}, employerSignature: null },
    firstName: 'בדיקה',
    lastName: 'אוטומטית',
    employeeNumber: '900001',
    departmentCode: 15,
    correctionNote: null,
  });
  pdfFiller.renderSignedPdf.mockResolvedValue({ pdf: SIGNED_BYTES, drawings: {} });
  pdfFiller.addPreviewWatermark.mockResolvedValue(PREVIEW_BYTES);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SigningStepsService.preview', () => {
  it('builds with the same renderSignedPdf input as submit, at the current second', async () => {
    await service().preview(access, body, client);
    // Submit stops right after building (storage refuses), so both inputs can be compared.
    files.storePdf.mockRejectedValue(new Error('stop after building'));
    await expect(service().submit(access, { ...body, acknowledged: true }, client)).rejects.toThrow(
      'stop after building',
    );

    const [previewInput, submitInput] = pdfFiller.renderSignedPdf.mock.calls.map(
      ([input]) => input,
    );
    expect(previewInput).toEqual(submitInput);
    expect(previewInput).toMatchObject({
      templateBytes: TEMPLATE_BYTES,
      signatureImage: body.signatureImage,
      submitted: { emailChoice: 'office', email: undefined, answers: body.answers, drawings: {} },
      signedAt: new Date('2026-11-01T10:00:00.000Z'),
      reference: '3F9A-1C2B-7D40',
      documentName: 'חוזה לדוגמה',
      font: FONT,
    });
  });

  it('returns the watermarked bytes and saves, sends or changes nothing', async () => {
    const pdf = await service().preview(access, body, client);

    expect(pdf).toBe(PREVIEW_BYTES);
    expect(pdfFiller.addPreviewWatermark).toHaveBeenCalledWith(SIGNED_BYTES, FONT);
    expect(files.storeImage).not.toHaveBeenCalled();
    expect(files.storePdf).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(queue.sendMany).not.toHaveBeenCalled();
    expect(repository.lockForSigning).not.toHaveBeenCalled();
    expect(repository.markSigned).not.toHaveBeenCalled();
    expect(repository.insertResponses).not.toHaveBeenCalled();
    expect(repository.deleteSessions).not.toHaveBeenCalled();
    expect(repository.createSignedCopyEmail).not.toHaveBeenCalled();
  });

  it('logs one sign.previewed row with ids only', async () => {
    await service().preview(access, body, client);

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      actor: { type: 'employee' },
      action: 'sign.previewed',
      entity: { type: 'assignment', id: ASSIGNMENT_ID },
      ip: client.ip,
      details: { roundId: access.roundId, emailMessageId: access.emailMessageId },
    });
  });

  it('a refused build is the same 400, with nothing watermarked or logged', async () => {
    const refusal = new AppException('ANSWER_DOES_NOT_FIT', 400, { key: 'nickname' });
    pdfFiller.renderSignedPdf.mockRejectedValue(refusal);

    await expect(service().preview(access, body, client)).rejects.toBe(refusal);
    expect(pdfFiller.addPreviewWatermark).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
