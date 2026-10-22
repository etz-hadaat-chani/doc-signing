import { z } from 'zod';
import type { TemplateFieldSettings } from './template-fields.js';

/**
 * Limits for the images the employee draws: the signature and each drawing box (NFR-SIG-3).
 * The pads are on a computer with a mouse (PRD §2, NFR-USE-2): at least 500 × 200 on screen,
 * so 625 × 250 at 125% Windows scaling, 750 × 300 at 150%, up to 3× zoom. A mouse signature on
 * such a pad is about 30–150 KB as PNG.
 */
export const DRAWN_IMAGE_MAX_BYTES = 500 * 1024;
/** Each side in pixels: a small initials pad at 100% up to 3× zoom of a wide pad. */
export const DRAWN_IMAGE_MIN_PIXELS = 50;
export const DRAWN_IMAGE_MAX_PIXELS = 3000;
/** Width × height at most, so reading the pixels never takes more than about 12 MB. */
export const DRAWN_IMAGE_MAX_AREA = 3_000_000;
/**
 * "Not empty": at least this many clearly visible pixels, spread over at least this many pixels
 * (the ink's longest side). A blank pad, one click (a dot) or a tiny mark is refused.
 */
export const DRAWN_IMAGE_MIN_INK_PIXELS = 50;
export const DRAWN_IMAGE_MIN_INK_SPAN = 20;

/**
 * The reference printed on a signed document (NFR-SIG-1): the first 12 hex digits of the
 * assignment id, upper case, in groups of 4 (`3F9A-1C2B-7D40`). The id is a random uuid (v4), so
 * this has no meaning and is not secret; it is never the link token. The office finds the
 * assignment by the id's prefix.
 */
export function signingReference(assignmentId: string): string {
  const hex = assignmentId.replace(/-/g, '').toUpperCase();
  if (!/^[0-9A-F]{32}$/.test(hex)) throw new Error('signingReference needs a uuid');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

/** The lowest and highest uuid with this reference: a range on the primary key finds it. */
export function signingReferenceRange(reference: string): { from: string; to: string } | null {
  const match = /^([0-9A-F]{4})-?([0-9A-F]{4})-?([0-9A-F]{4})$/i.exec(reference.trim());
  if (!match) return null;
  const prefix = `${match[1]}${match[2]}-${match[3]}`.toLowerCase();
  return {
    from: `${prefix}-0000-0000-000000000000`,
    to: `${prefix}-ffff-ffff-ffffffffffff`,
  };
}

// ---------------------------------------------------------------------------
// Public signing API (3.13): /api/sign/:token/*
// ---------------------------------------------------------------------------

/** The signing session lasts this long from the correct ID number, fixed (FR-SGN-8). */
export const SIGN_SESSION_MINUTES = 15;
/** Wrong ID numbers allowed per link before the assignment locks (FR-SGN-2, NFR-SEC-3). */
export const MAX_ID_ATTEMPTS = 5;
/**
 * The submit body's limit: the signature and up to 5 drawings at 500 KB each as base64
 * (≈ 667 KB each, ≈ 4 MB) plus the text answers. Only the submit route takes this much.
 */
export const SIGN_SUBMIT_MAX_BYTES = 5 * 1024 * 1024;
/** A base64 PNG of `DRAWN_IMAGE_MAX_BYTES`, with a `data:` prefix and some room. */
export const SIGN_IMAGE_MAX_CHARS = Math.ceil((DRAWN_IMAGE_MAX_BYTES * 4) / 3) + 100;

/** What a signing link shows before the ID check (FR-SGN-1, FR-SGN-7): no personal details. */
export const SIGN_LINK_STATES = ['valid', 'signed', 'cancelled', 'expired', 'locked'] as const;
export type SignLinkState = (typeof SIGN_LINK_STATES)[number];

/**
 * The per-IP limits on the public signing routes, per 15-minute window, across all links. They
 * only stop floods: many employees reach us through one filter IP (NetFree, Etrog, Nativ, Rimon;
 * PRD §2), and the real guard is the 5-attempt lock per link. Defaults fit about 200 employees
 * signing from one IP in one window (≈ 20 requests each); env can raise them, never below `min`.
 */
export const SIGN_RATE_SCOPES = [
  'all',
  'state',
  'verify',
  'verify_wrong',
  'document',
  'form',
  'fit',
  'submit',
] as const;
export type SignRateScope = (typeof SIGN_RATE_SCOPES)[number];
export const SIGN_RATE_WINDOW_MINUTES = 15;
export const SIGN_RATE_LIMITS: Readonly<
  Record<SignRateScope, { readonly min: number; readonly default: number }>
> = {
  all: { min: 600, default: 6000 },
  state: { min: 200, default: 2000 },
  verify: { min: 100, default: 1000 },
  verify_wrong: { min: 30, default: 300 },
  document: { min: 60, default: 1000 },
  form: { min: 100, default: 1000 },
  fit: { min: 300, default: 4000 },
  submit: { min: 30, default: 300 },
};

/** `POST /api/sign/:token/verify`. The shape and check digit are checked by the server. */
export const signVerifySchema = z.strictObject({
  idNumber: z.string().max(20),
});
export type SignVerifyInput = z.infer<typeof signVerifySchema>;

const imageText = z.string().max(SIGN_IMAGE_MAX_CHARS);

/**
 * `POST /api/sign/:token/submit` (FR-SGN-4, FR-SGN-5, FR-SGN-9): the envelope. The answers part
 * (`emailChoice`, `email`, `answers`, `drawings`) is then checked with the template's own rules
 * (`buildAnswersSchema`), by the server and by the signing screen (6.4) alike.
 */
export const signSubmitSchema = z.strictObject({
  signatureImage: imageText,
  acknowledged: z.literal(true, { error: 'SIGN_ACK_REQUIRED' }),
  emailChoice: z.string().max(20).optional(),
  email: z.string().max(1000).optional(),
  answers: z.record(z.string().max(50), z.union([z.string().max(5000), z.boolean()])).optional(),
  drawings: z.record(z.string().max(50), imageText).optional(),
});
export type SignSubmitInput = z.infer<typeof signSubmitSchema>;

/** `POST /api/sign/:token/fit`: does her text fit its place in the document (FR-TPL-9)? */
export const signFitSchema = z.strictObject({
  answers: z.record(z.string().max(50), z.string().max(5000)),
});
export type SignFitInput = z.infer<typeof signFitSchema>;

/** The HR contact on the message screens (B5). */
export interface SignHrContact {
  name: string;
  phone: string | null;
  email: string | null;
}

/** `GET /api/sign/:token`: the state and whom to call. Nothing about the employee. */
export interface SignLinkStateResult {
  state: SignLinkState;
  hrContact: SignHrContact;
}

/** `POST …/verify` when correct. */
export interface SignVerifiedResult {
  /** When the session ends (ISO). */
  sessionExpiresAt: string;
}

/**
 * `GET /api/sign/:token/form` (B3): the boxes she fills in, in the template's order, with their
 * settings (never a value from her card except the email pre-fill). `fields` and
 * `leftForEmployee` go straight into `buildAnswersSchema` with `signingDay`.
 */
export interface SignFormResult {
  documentName: string;
  /** Today in Israel, `YYYY-MM-DD`: the value of `signing_day` date limits. */
  signingDay: string;
  /** "תיקון נדרש: <note>" for a correction round (FR-TRK-6), else null. */
  correctionNote: string | null;
  /** The email box's pre-fill (her stored email at the send), or null. */
  emailPrefill: string | null;
  fields: TemplateFieldSettings[];
  leftForEmployee: string[];
}

/** `POST …/fit`: keys whose text would not fit its place at the smallest font. */
export interface SignFitResult {
  tooLong: string[];
}

/** `POST …/submit` (201). */
export interface SignSubmittedResult {
  state: 'signed';
  signedAt: string;
  /** The reference printed in the footer (not secret). */
  reference: string;
}
