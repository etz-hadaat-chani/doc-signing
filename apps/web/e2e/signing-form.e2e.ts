import { expect, type Locator, type Page, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  checkPage,
  drawOn,
  openLink,
  type Person,
  RUN,
  SigningSetup,
  watchRequests,
} from './signing-helpers';

// Task 6.4 part A: the form half of B3 after the document, for a link and for the office
// computer. Nothing is submitted here (no signature is drawn; signing-submit.e2e.ts signs). Needs `pnpm dev` (with the
// worker, so the invitation reaches Mailpit).
// DANGER rules: see signing-helpers.ts (fake rows only, all cleaned up in afterAll).
// Nothing she types is ever printed: values are compared inside the test, never shown by an
// assertion message.

const SCREENS = 'test-results/signing';

// The Hebrew texts (the e2e files can't import the web app).
const T = {
  idField: 'מספר תעודת זהות',
  submit: 'המשך',
  document: 'צפייה במסמך',
  continue: 'המשך לחתימה',
  form: 'טופס וחתימה',
  correction: 'תיקון נדרש:',
  finish: 'המשך לתצוגה לפני חתימה',
  chooseFirst: 'הכפתור יופעל אחרי בחירה איך לקבל את תלוש השכר וההודעות.',
  signatureEmpty: 'לא נמצאה חתימה. יש לחתום עם העכבר בתוך המסגרת',
  toFix: (count: number) => `יש לתקן ${String(count)} שדות.`,
  required: 'יש למלא שדה זה',
  invalidEmail: 'כתובת האימייל אינה תקינה',
  doesNotFit: 'הטקסט ארוך מדי למקום שלו במסמך. יש לקצר אותו',
  byEmail: 'לקבל באימייל',
  emailField: 'כתובת אימייל',
  office: 'אין לי אימייל ואני רוצה לקבל את תלוש השכר וההודעות במשרד המוסד בעיר שלי',
  drawing: 'משטח ציור: ראשי תיבות',
  kioskField: 'קוד',
  kioskAccepted: 'הקוד התקבל.',
  optional: '(לא חובה)',
};

// The boxes (labels are the template's own).
const L = {
  note: 'הערה',
  story: 'פירוט',
  size: 'מידה',
  city: 'עיר',
  car: 'יש לי רכב',
  carNumber: 'מספר רכב',
  start: 'תאריך התחלה',
  tiny: 'קוד קצר',
};
const CITIES = [
  'ירושלים',
  'בני ברק',
  'בית שמש',
  'אלעד',
  'מודיעין עילית',
  'ביתר עילית',
  'צפת',
  'חיפה',
];

const setup = new SigningSetup('95');
const people = {} as Record<'link' | 'kiosk', Person>;
let kioskRoundId = '';

/** One A4 page with a heading, built here (no file in the repo). */
async function testPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  page.drawText('Automated form test', { x: 60, y: 800, size: 16, font });
  return Buffer.from(await pdf.save());
}

/** Every box type, a condition, a date range, the email pair and a box too small for much. */
async function createFormTemplate(): Promise<string> {
  const at = (y: number, width = 220, height = 20) => ({ page: 1, x: 60, y, width, height });
  const fields: object[] = [
    { fieldType: 'full_name', ...at(770) },
    { fieldType: 'text', key: 'e2e_note', label: L.note, ...at(730, 300, 24) },
    {
      fieldType: 'long_text',
      key: 'e2e_story',
      label: L.story,
      options: { maxLength: 300 },
      ...at(620, 400, 90),
    },
    {
      fieldType: 'select',
      key: 'e2e_size',
      label: L.size,
      options: { choices: ['קטן', 'בינוני', 'גדול'] },
      ...at(580, 120),
    },
    {
      fieldType: 'select',
      key: 'e2e_city',
      label: L.city,
      options: { choices: CITIES },
      ...at(550, 200),
    },
    { fieldType: 'checkbox', key: 'e2e_car', label: L.car, isRequired: false, ...at(520, 12, 12) },
    {
      fieldType: 'text',
      key: 'e2e_car_number',
      label: L.carNumber,
      showWhen: { key: 'e2e_car', equals: 'true' },
      ...at(495, 150),
    },
    {
      fieldType: 'date_input',
      key: 'e2e_start',
      label: L.start,
      options: { minDate: 'signing_day' },
      ...at(465, 100),
    },
    { fieldType: 'drawing', key: 'e2e_initials', label: 'ראשי תיבות', ...at(400, 120, 50) },
    { fieldType: 'email_input', ...at(350, 250) },
    { fieldType: 'no_email_checkbox', ...at(320, 12, 12) },
    { fieldType: 'text', key: 'e2e_tiny', label: L.tiny, ...at(290, 30, 12) },
    { fieldType: 'signature', ...at(150, 220, 60) },
  ];
  return setup.createReadyTemplate('טופס', await testPdf(), { fields });
}

test.beforeAll(async () => {
  await setup.start();
  const templateId = await createFormTemplate();
  people.link = await setup.createFakeEmployee(0, `e2e-form-${RUN}-link@example.test`);
  people.kiosk = await setup.createFakeEmployee(1);
  await setup.sentRound('טופס', templateId, [people.link.id]);
  kioskRoundId = await setup.sentRound('משרד טופס', templateId, [people.kiosk.id]);
});

test.afterAll(async () => {
  await setup.finish();
});

/** The page as the employee sees it now (one viewport). */
async function shot(page: Page, name: string, fullPage = false) {
  await page.evaluate(
    'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))',
  );
  await page.screenshot({
    path: `${SCREENS}/b3-chromium-${name}.png`,
    animations: 'disabled',
    fullPage,
  });
}

/** ID, the document to its end, "continue": the form, scrolled to the top. */
async function reachForm(page: Page, idNumber: string, formPath: string) {
  await page.getByRole('textbox', { name: T.idField }).fill(idNumber);
  await page.getByRole('button', { name: T.submit }).click();
  await expect(page.getByRole('heading', { level: 1, name: T.document })).toBeVisible();
  const button = page.getByRole('button', { name: T.continue });
  await expect(button).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('End');
  await expect(button).toBeEnabled();
  const form = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith(formPath),
  );
  await button.click();
  const answer = await form;
  expect(answer.status()).toBe(200);
  expect(answer.headers()['cache-control']).toBe('no-store');
  await expect(page.getByRole('heading', { level: 1, name: T.form })).toBeVisible();
  expect(Number(await page.evaluate('window.scrollY'))).toBe(0);
}

/** Today in Israel as DD/MM/YYYY (the date box's earliest day). */
function todayIL(): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

/** A value is in the field, without ever printing it. */
async function holds(field: Locator, value: string) {
  expect((await field.inputValue()) === value, 'the field keeps what was typed').toBe(true);
}

/** Large and clear for older users: 20 px text, a whole radio row of at least 44 px. */
async function checkSizes(page: Page) {
  const sizes = await page.evaluate(`(() => {
    const field = [...document.querySelectorAll('label')].find((l) => l.textContent === '${L.note}');
    const input = field && document.getElementById(field.htmlFor);
    const radio = [...document.querySelectorAll('label')].find((l) => l.textContent === 'בינוני');
    const box = [...document.querySelectorAll('label')].find((l) => l.textContent.startsWith('${L.car}'));
    return {
      font: input ? getComputedStyle(input).fontSize : '',
      radio: radio ? radio.getBoundingClientRect().height : 0,
      checkbox: box ? box.getBoundingClientRect().height : 0,
    };
  })()`);
  expect(sizes).toMatchObject({ font: '20px' });
  const { radio, checkbox } = sizes as { radio: number; checkbox: number };
  expect(radio).toBeGreaterThanOrEqual(44);
  expect(checkbox).toBeGreaterThanOrEqual(44);
}

test.use({ viewport: { width: 1280, height: 720 } });

test('a link: required errors, every box filled, the condition, a bad email, the fit warning, only the signature left', async ({
  page,
}) => {
  const path = await setup.linkPathFor(people.link.email ?? '');
  const urls = watchRequests(page);
  await openLink(page, path);
  await reachForm(page, people.link.idNumber, '/form');
  await expect(page.getByText(T.correction)).toHaveCount(0);
  await checkSizes(page);
  await shot(page, '1-top');

  // No email choice yet: the button to the preview is off and says why.
  const finish = page.getByRole('button', { name: T.finish });
  await expect(finish).toBeDisabled();
  await expect(page.getByText(T.chooseFirst)).toBeVisible();
  // Nothing filled in: an error next to each required box (7) and the signature, the first one
  // focused. The reading statement is on the preview screen (6.5), not here.
  await page.getByRole('radio', { name: T.office }).check();
  await finish.click();
  const note = page.getByRole('textbox', { name: L.note });
  await expect(note).toHaveAttribute('aria-invalid', 'true');
  await expect(note).toBeFocused();
  await expect(page.getByText(T.toFix(8))).toBeVisible();
  await shot(page, '2-errors');

  await note.fill('בדיקה אוטומטית');
  await page.getByRole('textbox', { name: L.story }).fill('שורה ראשונה\nשורה שנייה');
  await page.getByRole('radio', { name: 'בינוני' }).check();
  await page.getByRole('combobox', { name: L.city }).click();
  await page.getByRole('option', { name: 'צפת' }).click();

  // The car number appears only with the tick.
  const carNumber = page.getByRole('textbox', { name: L.carNumber });
  await expect(carNumber).toHaveCount(0);
  await page.getByRole('checkbox', { name: `${L.car} ${T.optional}` }).check();
  await expect(carNumber).toBeVisible();
  await carNumber.fill('1234567');

  await page.getByRole('textbox', { name: L.start }).fill(todayIL());
  await drawOn(page, page.getByRole('img', { name: T.drawing }));

  // The email ("office" was chosen above, which greys it out): back to "email", a bad address
  // is refused next to the box.
  const email = page.getByRole('textbox', { name: T.emailField });
  await expect(email).toBeDisabled();
  await holds(email, people.link.email ?? '');
  await page.getByRole('radio', { name: T.byEmail }).check();
  await email.fill('not-an-email');
  await expect(page.getByText(T.invalidEmail)).toBeVisible();
  await shot(page, '3-bad-email');
  await page.getByRole('radio', { name: T.office }).check();
  await expect(email).toBeDisabled();
  await expect(page.getByText(T.invalidEmail)).toHaveCount(0);
  await page.getByRole('radio', { name: T.byEmail }).check();
  await email.fill(people.link.email ?? '');

  // A text too long for its small place: the warning while typing, gone once shortened.
  const tiny = page.getByRole('textbox', { name: L.tiny });
  await tiny.fill('טקסט ארוך מאוד שלא ייכנס למקום הקטן');
  await expect(page.getByText(T.doesNotFit)).toBeVisible();
  await tiny.focus();
  await shot(page, '4-fit-warning');
  await tiny.fill('אב');
  await expect(page.getByText(T.doesNotFit)).toHaveCount(0);

  // Every box is good: only the signature is left; nothing sent.
  await finish.click();
  await expect(page.getByText(T.required)).toHaveCount(0);
  await expect(page.getByText(T.signatureEmpty)).toBeVisible();
  await expect(page.getByText('יש לתקן שדה אחד.')).toBeVisible();
  expect(urls.some((url) => url.endsWith('/preview') || url.endsWith('/submit'))).toBe(false);
  await shot(page, '5-only-signature-left');
  await shot(page, '6-full', true);

  // The conditional box hidden again: its answer is dropped.
  await page.getByRole('checkbox', { name: `${L.car} ${T.optional}` }).uncheck();
  await expect(carNumber).toHaveCount(0);
  await page.getByRole('checkbox', { name: `${L.car} ${T.optional}` }).check();
  await holds(carNumber, '');

  await checkPage(page, urls, [
    people.link.idNumber,
    'בדיקה אוטומטית',
    'not-an-email',
    encodeURIComponent('בדיקה'),
  ]);
});

test('the office computer: code, ID, document, then the same form with the kiosk cookie', async ({
  page,
}) => {
  const shortCode = await setup.openKiosk(kioskRoundId, people.kiosk.id);
  const urls = watchRequests(page);
  await page.goto('/kiosk');
  await page.getByRole('textbox', { name: T.kioskField }).fill(shortCode);
  await page.getByRole('button', { name: T.submit }).click();
  await expect(page.getByText(T.kioskAccepted)).toBeVisible();
  await reachForm(page, people.kiosk.idNumber, '/api/kiosk/form');

  // No stored email: the box starts empty, nothing chosen.
  await holds(page.getByRole('textbox', { name: T.emailField }), '');
  await expect(page.getByRole('radio', { name: T.byEmail })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: T.office })).not.toBeChecked();

  const fit = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/kiosk/fit',
  );
  await page.getByRole('textbox', { name: L.tiny }).fill('טקסט ארוך מאוד שלא ייכנס למקום הקטן');
  expect((await fit).status()).toBe(200);
  await expect(page.getByText(T.doesNotFit)).toBeVisible();
  await page.getByText(T.doesNotFit).scrollIntoViewIfNeeded();
  await shot(page, 'k-1-form');
  expect(urls.some((url) => new URL(url).pathname.startsWith('/api/sign/'))).toBe(false);
  await checkPage(page, urls, [people.kiosk.idNumber, shortCode]);
});
