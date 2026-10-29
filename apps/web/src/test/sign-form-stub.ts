import type { SignFormResult, TemplateFieldSettings } from '@doc-signing/shared';

/** One box as `GET …/form` gives it; the defaults are a required short text box. */
export function formBox(
  key: string,
  settings: Partial<TemplateFieldSettings> = {},
): TemplateFieldSettings {
  return {
    fieldType: 'text',
    key,
    fillMode: 'employee',
    showWhen: null,
    options: { maxLength: 100 },
    isRequired: true,
    label: key,
    needsApproval: false,
    ...settings,
  };
}

/** The email pair (FR-SGN-9), as a template has it. */
export const EMAIL_PAIR: TemplateFieldSettings[] = [
  formBox('email_input', { fieldType: 'email_input', label: null, options: null }),
  formBox('no_email_checkbox', { fieldType: 'no_email_checkbox', label: null, options: null }),
];

/** A `GET …/form` answer; by default one short text box "הערה" and no email section. */
export function formAnswer(overrides: Partial<SignFormResult> = {}): SignFormResult {
  return {
    documentName: 'חוזה עבודה',
    signingDay: '2026-10-29',
    correctionNote: null,
    emailPrefill: null,
    fields: [formBox('note', { label: 'הערה' })],
    leftForEmployee: [],
    ...overrides,
  };
}
