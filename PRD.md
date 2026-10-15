# PRD – Digital Document Signing & Tracking System

Oct 15, 2026 · @Chana

## 1. Executive summary

The system automates sending, signing and tracking employee documents for about 1,500 employees. It replaces a manual paper-and-email process. Managers and officers see each employee's status in real time.

**How it works in one paragraph:** a manager uploads the employee list from Excel and a ready PDF for each department. The manager chooses who gets a document: all employees, some departments, a hand-picked group, or one employee. Each employee gets an email with a personal link. They enter their ID number, read the document with their personal details already filled in, choose how they get notices (email or the office), and draw a signature with the mouse. The signed PDF is saved in a folder for their department, and a copy is emailed to them. Employees who don't sign get a reminder every 3 days until they sign.

| Item | Value |
| --- | --- |
| Product | Internal web system for digital document signing and tracking |
| Users | About 1,500 employees, plus managers and officers |
| Interface language | Hebrew only, right to left (RTL) |
| Hosting | Cloud, Israel region |
| Delivery approach | Lean MVP first; everything not essential moves to later phases (section 4) |
| Status | Approved for development, with the open items in section 14 |

### Key decisions

- **Three roles:** Manager (full access), Officer (view only), Employee (signs through a link, no account).
- **Managers and officers see all employees**, not just one department.
- **A simple hand-drawn signature is enough.** The requirement is a visible drawn signature in the PDF; no certificates.
- **Flexible sending through send rounds.** A round is one document sent to a chosen group, from all employees down to a single employee.
- **No SMS anywhere.** Employees are Orthodox and don't have smartphones; signing is designed for a computer and mouse.
- **Employees without email are handled manually**, with help from the system (print, upload a scan, office signing station).

## 2. Goals and success measures

The system succeeds when a manager can send a personalized document to any group of employees in one action and see who signed without chasing anyone by hand.

| # | Goal | Success measure |
| --- | --- | --- |
| G1 | Automate distribution | One action sends a personalized document to up to 1,500 employees; no manual preparation, printing or emailing. |
| G2 | Personalize automatically | Each employee gets their department's PDF with their personal details (name, ID number, address, phones, age, pension fund and more) filled in, with no manual editing. |
| G3 | Make signing easy | An employee can open, read and sign in a few minutes on a computer, with no account and no password. |
| G4 | Show real-time status | Managers and officers see each employee's status at any moment: sent, opened, signed, no email. |
| G5 | Follow up automatically | Employees who haven't signed get a reminder every 3 days, with no manual chasing. |
| G6 | Keep records organized | Every signed document is saved in a folder per department, and the employee gets a copy by email. |
| G7 | Allow growth | New document types (notices, hearings, external reports) can be added without rebuilding the core. |

## 3. Users and roles

The system has three roles. Managers do everything, officers only view, and employees only sign.

| Role (Hebrew) | Who | What they do | Login |
| --- | --- | --- | --- |
| Manager (מנהל) | HR manager or senior manager | Everything: employees, templates, sending, tracking, settings and staff users | Email and password |
| Officer (קצין) | Officers who follow up | View only: dashboard, statuses, signed documents, Excel export | Email and password |
| Employee (עובד) | About 1,500 employees | Signs documents sent to them | No account; personal link plus ID number |

### Employee context that shapes the design

- **No smartphones and no SMS.** Employees are Orthodox. They sign on a computer, at home or at the office, with a mouse. Nothing in the system may depend on SMS or a phone app.
- **Filtered internet is likely** (NetFree, Etrog, Nativ, Rimon). These filters can block an unknown site, hold back links or attachments, or block the signing page. The domain and sending address must be whitelisted with the filter companies before launch (see section 14).
- **Shared computers are common** (family or office). Signing sessions must be short and must not stay logged in.
- **Some employees have no email.** They are handled manually, with system support: print the personalized PDF, upload a scan of the paper signature, or sign at an office signing station.
- **A wide range of computer skills.** Signing must take a few clear steps, in plain Hebrew, with large buttons.

## 4. Scope

The MVP covers one document type: a department PDF (an employment contract) that the system fills with the employee's details, plus a short section the employee fills in (how they get notices) and a drawn signature. Everything else is designed for but built later.

### In the MVP

- Three roles: manager, officer, employee.
- Excel import with a fixed column format: preview, checks, new employees added, existing employees updated. Besides the required columns it reads optional extra details (address, birth date, role, job %, pension fund and more) and two phones.
- One ready PDF per department, with set positions for the values the system fills in (name, ID number, address, phones, age, pension fund choice, date and more), the employee's signature (in one or more places), and the employer's (עץ הדעת) signature.
- The values are saved with each assignment when it is sent; an employee with a missing required value is not sent the document until the manager fills it in.
- Employee input on the document: checkbox and text fields, saved in `assignment_responses`. In the MVP: the email section (keep or correct the email, or "no email, notices at the office"), the same in every contract.
- The employer's signature and stamp image, uploaded once, placed on the document before or after the employee signs (a setting per template).
- Flexible send rounds: all employees, chosen departments, hand-picked employees, or one employee.
- Signing with ID check and a mouse-drawn signature.
- Signed PDF saved in a folder per department, and a copy emailed to the employee.
- Automatic reminders every 3 days until the employee signs.
- Round tracking: statuses, filters, Excel export, ZIP download of signed files.
- Manual handling: print the personalized PDF, upload a scanned paper signature.
- Office signing station.
- Activity log (recorded from day one, no screen yet).

### Out of scope

- Personal employee portal (no login area or document history for employees).
- SMS or WhatsApp sending.
- Advanced or certified digital signatures (smart card, certificates).
- Automatic sync with HR or payroll systems (data comes from Excel only).
- Signing by people who aren't employees.

### Later development

| Feature | Why later | Already prepared in the MVP |
| --- | --- | --- |
| Employee notice and hearing notice (checkbox acknowledgment) | New form type | `checkbox` / `text` input fields and `assignment_responses` (built in the MVP for the email section) |
| The employee fills in a personal detail the system is missing | MVP blocks sending until the manager fills it in | Input fields and `assignment_responses`. Personal details only (for example address or phone), never employment terms |
| After-school contract (צהרונית / סייעת צהרון) | Fields not decided yet (section 14) | Pension field option "ב only" |
| Attendance reports from Har Gal (one ready PDF per employee) | Depends on the Har Gal export format | `assignments.source_file_key` |
| Visual drag-and-drop field editor | MVP sets field positions once per PDF | `template_fields` table |
| Column matching for different Excel layouts | MVP reads the Har Gal export by fixed header names | `import_batches` table |
| Two-step login for staff (code by email) | Not needed for launch | — |
| Scheduled sending at a later time | Not needed for launch | — |
| Dashboard charts | MVP shows counts | — |
| Activity log screen | Log is already recorded | `audit_log` table |
| Editing email texts in the interface | MVP uses fixed Hebrew texts | `settings` table |
| Organizational digital seal on the PDF | Not required | — |
| Delivery-only rounds (no signature) | Not needed for launch | `rounds.requires_signature`, `delivered` status, `assignments.source_file_key` |

**Delivery-only documents (later, for reports such as Har Gal):** a round can be marked "no signature needed" (`requires_signature = false`). It is sent once, with no reminders and no ID check; the status becomes "Delivered" when the email is accepted. Accepted files: PDF, Word (.docx), Excel (.xlsx) and images (PNG, JPG); macro files (.docm, .xlsm) are refused, and the file content is checked, not just its name. The file is sent as it is, with nothing filled in, as a download link in the email, not an attachment, because filters often block attachments. Har Gal input stays open: one PDF per employee, one large PDF split by employee, or Excel.


## 5. Core ideas and status model

Everything is tracked per **assignment**: one employee in one send round. That is what lets one employee be in several rounds at once, each with its own status.

| Term | Meaning |
| --- | --- |
| Send round (סבב שליחה) | One document sent to a chosen group of employees, tracked on its own. For example "Annual contract 2027". |
| Round mode | **One template** for everyone in the round, or **by department**: each employee gets the PDF linked to their department. |
| Assignment | One employee in one round: which PDF they get, the values filled into it (saved when it is sent), their answers, their status, their signed file. |
| Template | A department's ready PDF plus the positions of every value the system fills in, the employee's input fields, the employee's signature and the employer's signature (FR-TPL-2). |
| Field values | The employee's details as filled into the document, saved with the assignment when it is sent (FR-RND-8). The employee views and signs exactly these. |
| Responses | What the employee chose or wrote on the signing screen (for example the email section), saved with the assignment (`assignment_responses`). |

### Assignment statuses

| Status (Hebrew) | Set when |
| --- | --- |
| Waiting to send (ממתין לשליחה) | The round was created; the email is in the queue. |
| Sent (נשלח) | The email provider accepted the invitation. |
| Opened (נפתח) | The employee entered a correct ID number. |
| Signed (נחתם) | The employee signed digitally. |
| Signed manually (נחתם ידנית) | A manager uploaded a scan of a paper signature. |
| Delivered (נמסר) | Delivery-only round (later): the email provider accepted the email. No  signature needed. |
| Missing data (חסרים פרטים) | A required value for the document is empty on the employee card (for example no address). Nothing is sent; needs manual handling (FR-MAN-1). Takes precedence over "No email". |
| No email (אין מייל) | The employee has no email address; needs manual handling. |
| Invalid email (מייל שגוי) | The email bounced; needs manual handling. |
| Cancelled (בוטל) | A manager cancelled the round or this employee. |

Two more conditions show on screen but are **flags, not statuses**, so the status isn't lost when they clear:

- **Locked (נעול):** 5 wrong ID attempts. A manager can unlock it, and the employee returns to their previous status.
- **Expired (פג תוקף):** the link expiry date passed before signing. Worked out from the date, not stored.

"Opened" means the employee entered their ID, not that the email was opened. Email-open tracking is unreliable, and filtered email makes it worse.

## 6. Functional requirements

All requirements below are MVP. Each has an ID so the team can link tasks and tests to it.

### Employees and Excel import

| ID | Requirement |
| --- | --- |
| FR-EMP-1 | A manager can upload the **Har Gal employee export** (`.xlsx`) as it is. Columns are found by these exact Hebrew headers, in any order; all other columns are ignored: מספר עובד, תעודת זהות, שם פרטי, שם משפחה, מחלקה, E-Mail, קידומת, טלפון, נייד פרטי - קידומת, נייד פרטי - מספר. A missing required header fails the whole file. Employee number and ID number may arrive as numbers: they are read as text, and the ID number gets its leading zeros back. The department cell is "code - name" (for example "15 - ממלאות מקום ירושלים"). Two phones (FR-EMP-9). An empty E-Mail means "No email". **Optional extra columns**, read by these exact headers when present (a missing one doesn't fail the file): כתובת, יישוב, תאריך לידה, תאור תפקיד, מעמד, אחוז משרה, ימי עבודה, שעות עבודה, קוד קופ"ג א, קוד קופ"ג ב, קוד קרן השתלמות. תאריך לידה arrives as an Excel date cell (a date is accepted for this column only); אחוז משרה and שעות עבודה arrive as numbers; ימי עבודה is text. The three fund columns hold the fund's **name** as text (letters only in the sample), stored trimmed, with no code list (section 14). Salary and balance data is never imported; every other column is ignored. |
| FR-EMP-2 | Before saving, the system shows a preview: new, updated, unchanged and rows with errors (with the reason per row), plus new departments and **renamed departments** (known code, different name). Each updated employee lists every change as **"field: old → new"**, including changes that overwrite a manual edit (FR-EMP-4). |
| FR-EMP-3 | Checks: valid Israeli ID number (check digit), no repeated employee numbers or ID numbers in the file, an ID number not already used by another employee, the email format when present, and a department cell in the form code - name: digits, optional spaces, "-", optional spaces, name. It is split at the **first** hyphen only, because names can contain hyphens and numbers ("45 - ממלאות מקום אלעד-45"). The code must be a whole number above 0, and the name must not be empty. A bad cell makes that row an error. A wrong email format is **not** an error: the row is imported with email status `invalid` (FR-EMP-4) and listed as a warning with its row number, so the employee still appears in manual handling. A phone that can't be read is saved empty, also as a warning. An extra-column cell that can't be read (a birth date that isn't a date or is in the future, a job % or hours cell that isn't a number, text that is too long) is a warning too: that value is not written and the row is still imported. |
| FR-EMP-4 | On confirm, rows are matched by **employee number**: new numbers create employees, existing numbers update them. Employees missing from the file are left as they are, because payroll exports may be filtered by department. A manager can mark an employee inactive by hand. **Har Gal is the main source:** an import overwrites the fields it carries, including manual edits (FR-EMP-7). Email status: same email as stored → status kept as it is (a bounced email stays bounced); different email → `valid`, or `invalid` if the format is wrong; empty → `missing`. **Extra columns** (FR-EMP-1): an empty cell, or a column missing from the file, never erases a stored value; only a filled cell overwrites it. The 10 required columns keep the rules above. The preview shows every change, including the extra fields, as "field: old → new". An import never sends anything (FR-EMP-6). |
| FR-EMP-5 | Departments are matched by **code**, not by name. New codes in the file are created during import, after the manager confirms them. A known code with a different name renames the department on confirm (shown as "department renamed" in the preview). |
| FR-EMP-6 | Employees without a valid email are marked "No email" and appear in manual handling. When an import adds an email, **nothing is sent automatically**: the employee's open assignments in status `no_email` appear in manual handling as "email added, ready to send", and the manager sends them with one click (FR-MAN-1). |
| FR-EMP-7 | A manager can add or edit a single employee (for example, fix an email), including the extra fields (address, city, birth date, role, employment status, job %, work days, work hours, pension funds א and ב, study fund) and both phones. The card also shows the age. The next import overwrites these edits with the Har Gal data (FR-EMP-4), so managers should make the same fix in Har Gal. |
| FR-EMP-8 | Every import is recorded: who, when, file, and counts. |
| FR-EMP-9 | Two phones, stored separately as `050-1234567` (a prefix that lost its leading 0 gets it back): **landline** = קידומת + טלפון, **mobile** = נייד פרטי - קידומת + נייד פרטי - מספר. Nothing is ever sent to them; they are filled into documents. |

### Templates

| ID | Requirement |
| --- | --- |
| FR-TPL-1 | A manager can upload a PDF, name it and link it to one or more departments. |
| FR-TPL-2 | Each template stores positions (page, X, Y, size) for what is drawn on it. In the MVP the developer sets these once per PDF. Any type can appear in any number of positions, or not at all. **System values:** full name, ID number, employee number, address ("כתובת, יישוב"), landline, mobile, age (whole years from the birth date, on the day the assignment is sent), role, employment status, job %, work days, work hours, study fund; pension fund (FR-TPL-5); document date ("drawn up and signed": today's date while the employee views the document, the signing date in the signed PDF; DD/MM/YYYY, Asia/Jerusalem). **Employee input:** the email section (FR-SGN-9), and general checkbox and text fields for later documents. **Signatures:** the employee's (FR-SGN-10) and the employer's (FR-TPL-7). The organization's own details (עץ הדעת) are part of the PDF itself, not fields. |
| FR-TPL-3 | A manager can preview a template filled with a sample employee, to check the Hebrew text. The preview lists the values that sample employee is missing. |
| FR-TPL-4 | Once a template has been sent, it is locked. A change to its name, field positions or field settings, or to its employer-signature setting, creates a new version (same PDF); documents already sent don't change. Linking or unlinking departments changes the locked template in place, since it only decides which template future rounds offer. |
| FR-TPL-5 | **Pension fund.** Two checkbox positions, "has an active fund" and "has no active fund", plus a position for the fund name. A setting on the template's pension field picks the source: **"א, then ב"** (default: קופ"ג א; if empty, קופ"ג ב; if both are filled, א) or **"ב only"** (after-school contracts, which always use קופ"ג ב). If the column(s) used have a name: "has an active fund" is ticked and the name is written; if empty: "has no active fund" is ticked. An empty fund is a valid answer, never "missing data". |
| FR-TPL-6 | Each system-value position is **required** (default) or **may stay empty** (for example the landline, which many employees don't have). A required value that is empty for an employee means "missing data" (FR-RND-4); an optional one is drawn blank. |
| FR-TPL-7 | **Employer signature** (עץ הדעת), a setting per template: **already on the document when sent** (the employee receives the document signed by the employer, then signs herself), **added after the employee signs** (only in the signed PDF), or **none**. The image is the one the manager uploaded (FR-ADM-2), placed at the template's employer-signature positions. |
| FR-TPL-8 | A template can be used in a round only when it is complete: at least one employee-signature position marked "always"; the email box and the "no email" checkbox come together; "has an active fund" and "has no active fund" come together; a template with an employer signature has at least one employer-signature position. |

### Send rounds

| ID | Requirement |
| --- | --- |
| FR-RND-1 | A manager creates a round with a name and a mode: one template, or by department. |
| FR-RND-2 | Recipients can be chosen and combined: all employees, chosen departments, hand-picked employees, or one employee (also from the employee card). |
| FR-RND-3 | In by-department mode, the system picks each department's template and warns if a department in the round has none. |
| FR-RND-4 | Before sending, the system shows counts: will get email, no email, already signed this template in another round (skip or send again), and **missing data**, with a list of who is missing what (for example "address, mobile"). Employees with missing data are added to the round in status "Missing data" and nothing is sent to them until the manager fills in the employee card (FR-MAN-1). |
| FR-RND-5 | Per round: reminders on/off, reminder interval (default 3 days), link expiry (default 60 days). Reminders continue until the employee signs; an optional maximum can be set. |
| FR-RND-6 | Sending runs in the background in batches; the round screen shows progress. |
| FR-RND-7 | A manager can cancel a round or a single recipient. |
| FR-RND-8 | **Values are saved at send.** When an assignment is sent (also for "No email" assignments, so they can be printed), the system checks the required values again and saves the filled-in values with the assignment (`assignments.field_values`), including the age on that day and which employer-signature image is used. A value missing at that moment sets "Missing data" instead. The view, the print and the signed PDF all use the saved values; a later import or card edit doesn't change a document already sent. To change one, cancel it and send again. |

### Signing (employee)

| ID | Requirement |
| --- | --- |
| FR-SGN-1 | Each employee gets a unique link. The link shows no personal details until the ID number is entered. |
| FR-SGN-2 | The employee enters their ID number. 5 wrong attempts lock the assignment until a manager unlocks it. |
| FR-SGN-3 | The employee sees their personalized PDF (the saved values filled in, FR-RND-8; the employer signature if the template has it "already on the document") and must scroll to the end before signing. |
| FR-SGN-4 | The employee fills in the email section (FR-SGN-9), draws a signature with the mouse (touch also works), can clear and redraw, and confirms a reading statement. |
| FR-SGN-5 | On confirm, the system places the signature (FR-SGN-10), the date, the employee's answers (FR-SGN-9) and, if set, the employer signature ("added after the employee signs") in the PDF, locks the file against edits, and adds a small line with the signing date, time and reference number. |
| FR-SGN-6 | The signed PDF is saved under round / department (at send time, `assignments.department_id`) / employee, and a copy is emailed to the employee at the address the link was sent to (never to an address the employee typed in the email section). |
| FR-SGN-7 | After signing, the link only shows "Already signed". Expired, cancelled and locked links show a clear Hebrew message with HR contact details. |
| FR-SGN-8 | The signing session ends after 15 minutes or when the browser closes. |
| FR-SGN-9 | **Email section** (the same in every contract). The employee must choose exactly one: (a) **an email**: the box is pre-filled with the email the system has; she can keep or correct it; or (b) tick **"I have no email and want my payslip and notices at the institution's office in my city"**. She can't sign without choosing one. Checks: valid email format, at most 254 characters, exactly one option. The answer is saved with the assignment (`assignment_responses`), drawn into the signed PDF, shown to managers and officers, and included in the Excel export. A corrected email **never** overwrites the employee's stored email; it shows in manual handling (FR-MAN-1) so it can be fixed in Har Gal. |
| FR-SGN-10 | **One drawn signature, several positions.** The employee draws once; the system places that drawing at every employee-signature position of the template. Each position is either **"always"** (the main signature, the employee declaration) or **"only if (b) no email was chosen"** (the signature line under that option). |

### Reminders and email

| ID | Requirement |
| --- | --- |
| FR-REM-1 | A daily job sends reminders to recipients in Sent or Opened status whose last email was at least the reminder interval ago. |
| FR-REM-2 | Reminders stop only when the employee signs, the link expires or the manager cancels. There is no maximum by default. |
| FR-REM-3 | A manager can send a reminder now, to one employee or to everyone who hasn't signed in a round. |
| FR-REM-4 | Bounced emails change the status to "Invalid email". |
| FR-REM-5 | Every link sent (invitation or reminder) keeps working until the employee signs or the link expires. |

### Tracking

| ID | Requirement |
| --- | --- |
| FR-TRK-1 | The dashboard shows totals across active rounds: signed, waiting, opened, no email. |
| FR-TRK-2 | The round screen lists every recipient with status, last update and reminders sent; filters by status and department (at send time); search by name, employee number or ID. For signed employees it also shows the email-section answer: "email" or "at the office", the email given, and whether it differs from the system email. |
| FR-TRK-3 | Managers and officers can open any signed document. Each view is logged. |
| FR-TRK-4 | Export a round's statuses to Excel, including the email-section answer (choice, email given, differs from the system email), and download all signed files as a ZIP in department folders (department at send time). |
| FR-TRK-5 | The employee card shows the employee's history across all rounds. |

### Manual handling

| ID | Requirement |
| --- | --- |
| FR-MAN-1 | A list of everyone with no email or a bounced email, across rounds. Open assignments in status `no_email` whose employee now has a valid email (for example, added by an import) are marked **"email added, ready to send"**, with a one-click send (a new invitation with a new link). The list also shows: open assignments in status **"Missing data"**, with what is missing; once the employee card is filled in they are marked **"details completed, ready to send"**, and the send checks again, saves the values (FR-RND-8) and sends, or sets "No email". And signed assignments where **"the employee corrected her email: old → new"** (FR-SGN-9), so the manager fixes it in Har Gal; worked out from the data, it disappears once the stored email matches the one she gave. |
| FR-MAN-2 | A manager can print an employee's personalized PDF (from the saved values, FR-RND-8). |
| FR-MAN-3 | A manager can upload a scan of a paper-signed document; the status becomes "Signed manually". No answers are stored for it: the paper itself is the record. |
| FR-MAN-4 | **Office signing station:** a manager opens signing for an employee on an office computer. The employee still enters their ID number, fills in the email section and signs themselves. |

### Administration

| ID | Requirement |
| --- | --- |
| FR-ADM-1 | A manager can add, disable and change the role of staff users. |
| FR-ADM-2 | A manager can change the default settings: reminder interval, maximum reminders, link expiry, sender name. A manager uploads the **employer signature and stamp image** (עץ הדעת) once: PNG only, content checked, size limit, private storage. Replacing it stores a new file (never an overwrite); assignments already sent keep the image saved with them (FR-RND-8). Uploads and views are logged; officers can't see it. |
| FR-ADM-3 | Every important action is written to an activity log that can't be edited. |

## 7. Screens

The MVP has 12 management screens and 5 employee screens, all in Hebrew, right to left.

Wherever a department is shown or picked (lists, filters, cards, wizard, exports), it appears as **"code - name"**, for example "15 - ממלאות מקום ירושלים", the way HR knows it from Har Gal. Department lists are sorted by code.

### Management area (managers and officers)

| # | Screen | Main contents | Who |
| --- | --- | --- | --- |
| A1 | Login (כניסה) | Email and password | All staff |
| A2 | Dashboard (לוח בקרה) | Totals across active rounds; rounds that need attention | All staff |
| A3 | Send rounds (סבבי שליחה) | Rounds with document, date, recipients, % signed, state | All staff |
| A4 | Round details (פרטי סבב) | One row per employee: status, department ("15 - name"), last update, reminders, email-section answer, link to signed PDF; filters (including department), search, export, ZIP; manager actions (remind, resend, cancel, unlock, manual signature, office signing) | All staff; actions for managers |
| A5 | New round wizard (אשף סבב חדש) | Name and mode, document, recipients (departments as "15 - name"), summary, settings, preview, send | Manager |
| A6 | Employees (עובדים) | List with department ("15 - name"), search and filters, email status mark, import and add buttons | All staff; edits for managers |
| A7 | Employee card (כרטיס עובד) | Details including department ("15 - name"), landline and mobile, address and city, birth date (DD/MM/YYYY) and age, role, employment status, job %, work days and hours, pension funds and study fund; history across rounds, signed documents, "Send document" shortcut | All staff; edits for managers |
| A8 | Excel import (ייבוא מאקסל) | Upload the Har Gal export, check report, preview (including new and renamed departments as "15 - name"), confirm | Manager |
| A9 | Templates (תבניות) | Templates with departments ("15 - name"), version, field positions (type, required or optional, "always" / "only if no email" signatures, pension source), employer-signature setting, preview with missing values | Manager |
| A10 | Manual handling (טיפול ידני) | Employees with no or bad email or missing data across rounds ("email added" / "details completed, ready to send"), and employees who corrected their email; print, upload scan, fix email | Manager |
| A11 | Settings (הגדרות) | Reminder interval, maximum reminders, link expiry, sender name, employer signature and stamp image | Manager |
| A12 | Staff users (משתמשי מערכת) | Add, disable, change role | Manager |

### Employee area (signing, computer and mouse first)

| # | Screen | Main contents |
| --- | --- | --- |
| B1 | ID check (אימות זהות) | Short welcome, ID number field, Continue |
| B2 | Document (צפייה במסמך) | The personalized PDF; the Sign button becomes active after scrolling to the end |
| B3 | Signature (חתימה) | Email section above the pad (email box pre-filled, or "no email, at the office"; exactly one), large drawing pad, Clear and Confirm buttons, reading statement checkbox |
| B4 | Done (אישור) | "The document was signed. A copy was sent to your email." |
| B5 | Messages | Link expired, already signed, locked, cancelled; each with HR contact details |

### Emails (Hebrew, right to left)

1. **Invitation:** document name, personal link and the link's expiry date (DD/MM/YYYY).
2. **Reminder:** the same request with a different subject; carries its own working link and the expiry date.
3. **Signed copy:** the signed PDF attached.

Emails stay short and light on images, to pass spam and internet filters.

## 8. User flows

Seven flows cover the MVP. The core is flow 3 (create a round) and flow 4 (signing).

### Flow 1: Import employees (manager)

1. Employees → Import from Excel; upload the Har Gal employee export (`.xlsx`) as it is (FR-EMP-1).
2. The system checks every row (FR-EMP-3) and shows the preview: new, updated, unchanged, errors, new and renamed departments.
3. The manager confirms any new departments (by code) and renames.
4. Confirm: new employee numbers are created, existing ones updated, missing ones left as they are.
5. Employees without a valid email are marked "No email".

### Flow 2: Set up a department template (manager + developer, once per PDF)

1. Templates → New; upload the department's ready PDF, name it, link departments.
2. The positions of the system values, the email section, the employee's signatures and the employer's signature are set (by the developer in the MVP), with the employer-signature setting and the pension source.
3. Preview with a sample employee to check the Hebrew text and the missing values; save.

### Flow 3: Create a send round (manager)

1. Send rounds → New round; enter a name.
2. Choose the mode: one template, or by department (each employee gets their department's PDF).
3. Choose recipients: all, departments, hand-picked, or one employee. Options can be combined.
4. Review the summary: X will get email, Y have no email, Z already signed (skip or send again), W missing data (who is missing what).
5. Check the round settings: reminders, interval, maximum, link expiry.
6. Preview one employee's document and the email.
7. Send. Each assignment's values are saved, and emails go out in the background; the round screen shows progress.

### Flow 4: Signing (employee)

1. The employee clicks the link in the email (invitation or any reminder).
2. They enter their ID number.
   - Correct: status becomes "Opened"; a 15-minute signing session starts.
   - Wrong: an error; after 5 wrong attempts the assignment locks and the attempt is logged.
3. They read their personalized document and scroll to the end.
4. They fill in the email section (keep or correct the email, or "no email, at the office"), draw a signature, tick the reading statement and confirm.
5. The system saves the answers, builds the signed PDF (signature in every matching position), locks it, saves it, records its hash, sets the status to "Signed", stops reminders and emails the copy.
6. The Done screen. Every link for this assignment now shows "Already signed".

### Flow 5: Reminders (system, daily)

1. The job runs every day at 09:00, Sunday to Thursday.
2. For each active round, it finds recipients in Sent or Opened status whose last email is at least the interval old.
3. It sends each one a reminder with its own link and counts it.
4. Bounces from the email provider set the status to "Invalid email".

### Flow 6: Tracking (manager or officer)

1. From the dashboard, open a round.
2. Filter, for example "department X, not signed".
3. Officer: view, open signed PDFs, export to Excel, download ZIP.
4. Manager can also remind now, fix an email and resend, unlock, cancel.

### Flow 7: Employees without email (manager)

1. Open Manual handling, or filter the round by "No email".
2. Choose one way:
   - **Missing data:** fill in the employee card, then send with one click ("details completed, ready to send").
   - **Office signing station:** open signing for the employee on an office computer; the employee enters their ID, fills in the email section and signs.
   - **Paper:** print the personalized PDF, have it signed, upload the scan; status becomes "Signed manually".
   - **Fix the email:** the system sends to the employee automatically.

## 9. Permissions

Permissions are checked on the server for every request, not only hidden in the interface.

| Action | Manager | Officer | Employee |
| --- | --- | --- | --- |
| See dashboard and all employees' statuses | Yes | Yes | No |
| View and download signed documents | Yes | Yes | Own copy, by email |
| Export to Excel, download ZIP | Yes | Yes | No |
| Import employees, edit an employee | Yes | No | No |
| Upload and edit templates | Yes | No | No |
| Create and send a round | Yes | No | No |
| Remind, resend, cancel, unlock | Yes | No | No |
| Manual handling and office signing station | Yes | No | No |
| Manage staff users and settings | Yes | No | No |
| Sign a document | No | No | Yes, with a valid link and ID number |

## 10. Architecture and technology

The system is a modular monolith: one TypeScript code base that runs as two processes, an API server and a background worker. This is the fastest build for a short timeline, and one small server (2 vCPU, 4 GB) carries the load of 1,500 employees.

&#91;embedded content: System architecture · 2 processes, 3 cloud services\]

The API puts jobs (send emails, build signed PDFs) in a queue inside PostgreSQL; the worker picks them up, so a bulk send never slows the screens.

### Technology stack

| Layer | Technology | Why |
| --- | --- | --- |
| Front end | React + TypeScript (Vite), MUI with RTL support | Common, fast to build with, good Hebrew RTL support |
| Back end | Node.js + TypeScript, NestJS | One language end to end; built-in structure for role checks |
| Database | PostgreSQL 16, managed service | Reliable, backups included |
| Data access | Prisma | Fast development, safe migrations |
| Background jobs | pg-boss (queue inside PostgreSQL) | No Redis needed; supports scheduled jobs |
| PDF | pdf-lib + fontkit, a Hebrew font (Heebo or Noto Sans Hebrew), bidi-js | Draws text and the signature onto the PDF; right-to-left ordering |
| Signature pad | signature\_pad | Smooth drawing with a mouse |
| Excel | ExcelJS | Reads and writes `.xlsx` |
| File storage | AWS S3 or Azure Blob, private | Templates and signed PDFs |
| Email | Amazon SES, Postmark or SendGrid | Bulk sending, bounce notices |
| Hosting | AWS Tel Aviv region or Azure Israel Central | Keeps data in Israel |

### Key technical decisions

- **Text is drawn at stored positions, not into PDF form fields.** The department PDFs are used as they are. The system draws the values, checkbox ticks, answers and signatures at the positions in `template_fields`. This avoids a known weakness: PDF form fields handle Hebrew right-to-left text poorly.
- **Values are saved at send; the PDF is drawn when opened.** When an assignment is sent, the values filled into the document are saved with it (`assignments.field_values`). The personalized PDF is drawn from those saved values when the employee opens it (or the manager prints it), not ahead of time, so a later import doesn't change a document already sent. The final signed PDF is built once, at signing, from the same values plus the answers.
- **One drawing, many positions.** The employee draws one signature; the same image is placed at every employee-signature position whose condition matches (FR-SGN-10). The employer signature is one uploaded image, placed per the template's setting (FR-TPL-7).
- **Every email carries its own link token.** Only a hash of each token is stored, so a reminder can't resend the original link. Instead each reminder gets a new token, and all tokens of an assignment work until it is signed or expires.
- **The import reads the Har Gal employee export as it is**: columns are found by exact Hebrew header names, other columns are ignored, and departments are matched by their Har Gal code. No sample file.

## 11. API endpoints

All management endpoints need a staff session; the role column says who may call them (M = manager, O = officer). Signing endpoints are public but protected by the link token and ID number.

### Staff login and users

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | Log in with email and password; sets the session cookie | — |
| POST | `/api/auth/logout` | Log out | M, O |
| GET | `/api/auth/me` | Current user and role | M, O |
| GET | `/api/users` | List staff users | M |
| POST | `/api/users` | Create a staff user | M |
| PATCH | `/api/users/:id` | Change role, disable, reset password | M |

### Employees and departments

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | `/api/employees?dept=&q=&emailStatus=&page=` | List with search, filters, paging | M, O |
| GET | `/api/employees/:id` | Employee card | M, O |
| GET | `/api/employees/:id/assignments` | History across rounds | M, O |
| POST | `/api/employees` | Add one employee | M |
| PATCH | `/api/employees/:id` | Edit an employee | M |
| POST | `/api/employees/import/preview` | Upload Excel; returns the check report, saves nothing | M |
| POST | `/api/employees/import/:batchId/commit` | Apply a previewed import | M |
| GET | `/api/departments` | List departments (code, name), sorted by code | M, O |

### Templates

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | `/api/templates?dept=&includeArchived=&page=` | List templates (default: active only, i.e. not archived and no newer version) | M |
| GET | `/api/templates/:id` | One template version with its departments and field positions | M |
| POST | `/api/templates` | Upload a PDF with name and departments | M |
| PATCH | `/api/templates/:id` | Update name, departments or field positions; a locked template gets a new version for a new name or positions | M |
| GET | `/api/templates/:id/preview?employeeId=` | PDF filled with a sample employee; the missing values are listed | M |
| POST | `/api/templates/:id/archive` | Archive a template | M |

### Send rounds

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | `/api/rounds` | List rounds with % signed | M, O |
| POST | `/api/rounds/recipients-preview` | Counts for a recipient choice: will send, no email, already signed, missing data (who is missing what) | M |
| POST | `/api/rounds` | Create a round (name, mode, templates, recipients, settings) | M |
| POST | `/api/rounds/:id/send` | Start sending | M |
| GET | `/api/rounds/:id` | Round details and status counts | M, O |
| GET | `/api/rounds/:id/assignments?status=&dept=&q=&page=` | Per-employee table | M, O |
| GET | `/api/rounds/:id/export` | Status export to Excel | M, O |
| GET | `/api/rounds/:id/download` | ZIP of signed files in department folders | M, O |
| POST | `/api/rounds/:id/remind` | Remind everyone who hasn't signed, now | M |
| POST | `/api/rounds/:id/cancel` | Cancel the round | M |

### Assignments (one employee in one round)

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | `/api/assignments/:id/document` | Redirect to a short-lived link to the signed PDF; logged | M, O |
| GET | `/api/assignments/:id/print` | Personalized PDF for paper signing | M |
| POST | `/api/assignments/:id/remind` | Remind this employee now | M |
| POST | `/api/assignments/:id/resend` | Resend, for example after fixing the email | M |
| POST | `/api/assignments/:id/unlock` | Unlock after 5 wrong ID attempts | M |
| POST | `/api/assignments/:id/cancel` | Cancel for this employee | M |
| POST | `/api/assignments/:id/manual-sign` | Upload a scanned paper signature | M |
| POST | `/api/assignments/:id/kiosk` | Open a one-time signing session at the office signing station | M |

### Dashboard and settings

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | `/api/dashboard/summary` | Totals across active rounds | M, O |
| GET | `/api/settings` | Read settings | M |
| PATCH | `/api/settings` | Update settings | M |
| POST | `/api/settings/employer-signature` | Upload the employer signature and stamp image (PNG); logged | M |
| GET | `/api/settings/employer-signature` | Short-lived link to the current image; logged | M |

### Employee signing (public)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/sign/:token` | Link state only: valid, expired, signed, locked, cancelled. No personal details. |
| POST | `/api/sign/:token/verify` | Body `{ idNumber }`. Correct: opens a 15-minute signing session and sets "Opened". Wrong: counts the attempt; locks at 5. |
| GET | `/api/sign/:token/document` | The personalized PDF; needs the signing session |
| POST | `/api/sign/:token/submit` | Body `{ signatureImage, acknowledged: true, emailChoice: "email" \| "office", email? }` (`email` required for `"email"`, FR-SGN-9). Saves the answers, builds and saves the signed PDF, emails the copy, closes all links of the assignment. |

### System

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | 200 `{ status: "ok", database: "ok" }`, or 503 with `database: "down"`. No versions or other details. Public. |

### Webhooks

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/webhooks/email` | Delivery and bounce notices from the email provider; the provider's signature is verified |

## 
12. Data model

The database has 14 PostgreSQL tables built around `assignments`, which links one employee, one round and one PDF. Conventions: primary keys are `uuid`, dates are `timestamptz`, and every table has `created_at` and `updated_at`, except `audit_log`, which has only `created_at` (not repeated below).

### Identity keys for employees

| Key | Used for | Why |
| --- | --- | --- |
| `id` (uuid) | Internal primary key and all foreign keys | Never changes and never leaves the system; length doesn't matter to the database |
| `employee_number` | **Matching rows on Excel import**, search, display | Short, known to HR, and the "מספר עובד" column of the Har Gal export |
| `id_number` | **Employee identity check when signing**; printed on the PDF | The employee knows it by heart; the employee number may not be known to them |

The employee number is a good business key, not a primary key: if it is ever reused or changed, only one field changes, and no history breaks. Confirmed: it is present for every employee, unique, and never reused.

### Tables and fields

**`users`**: staff users

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| full\_name | varchar(100) |  |
| email | varchar(255) UNIQUE | Login |
| password\_hash | text | Argon2 |
| role | enum `manager` / `officer` |  |
| is\_active | boolean |  |
| last\_login\_at | timestamptz NULL |  |

**`departments`**

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| code | integer UNIQUE, CHECK (code > 0) | Har Gal department number: the department's identity; the import matches by it |
| name | varchar(100) | Not unique and can change; the import updates it by code. Shown as "code - name" |
| is\_active | boolean |  |

**`employees`**

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| employee\_number | varchar(20) UNIQUE | Import match key |
| id\_number | char(9) UNIQUE | Israeli ID, padded with leading zeros |
| first\_name | varchar(50) |  |
| last\_name | varchar(50) |  |
| department\_id | uuid FK → departments |  |
| email | varchar(255) NULL |  |
| email\_status | enum `valid` / `missing` / `invalid` / `bounced` |  |
| landline | varchar(20) NULL | קידומת + טלפון, as `050-1234567`. Nothing is sent to it; filled into documents (FR-EMP-9) |
| mobile | varchar(20) NULL | נייד פרטי - קידומת + נייד פרטי - מספר, as `050-1234567`. Nothing is sent to it |
| address | varchar(150) NULL | כתובת (extra column: an empty cell never erases it, FR-EMP-4) |
| city | varchar(60) NULL | יישוב |
| birth\_date | date NULL | תאריך לידה; the age is worked out from it |
| job\_title | varchar(100) NULL | תאור תפקיד |
| employment\_status | varchar(50) NULL | מעמד |
| job\_percent | numeric(5,2) NULL | אחוז משרה |
| work\_days | varchar(50) NULL | ימי עבודה (text) |
| work\_hours | numeric(6,2) NULL | שעות עבודה |
| pension\_fund\_a | varchar(100) NULL | קוד קופ"ג א: the fund's name, as text |
| pension\_fund\_b | varchar(100) NULL | קוד קופ"ג ב: the fund's name, as text |
| study\_fund | varchar(100) NULL | קוד קרן השתלמות: the fund's name, as text |
| is\_active | boolean |  |
| last\_import\_id | uuid FK → import\_batches NULL |  |

**`import_batches`**: Excel imports

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| uploaded\_by | uuid FK → users |  |
| file\_name | varchar(255) |  |
| file\_key | text | Original file in storage |
| status | enum `preview` / `committed` / `failed` |  |
| rows\_total, rows\_created, rows\_updated, rows\_unchanged, rows\_failed | int |  |
| errors | jsonb | Rows with errors and the reason |
| committed\_at | timestamptz NULL |  |

**`templates`**: department PDFs

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| name | varchar(150) |  |
| kind | enum `signature` / `acknowledgment` / `external_report` | MVP uses `signature` |
| file\_key | text | Original PDF |
| page\_count | int |  |
| version | int | Starts at 1 |
| parent\_template\_id | uuid FK → templates NULL | Earlier version |
| is\_locked | boolean | True after first send |
| is\_archived | boolean |  |
| employer\_signature\_mode | enum `pre_signed` / `after_employee` / `none` | Default `none` (FR-TPL-7). The current contracts use `pre_signed` |
| created\_by | uuid FK → users |  |

**`template_departments`**: templates ↔ departments

| Field | Type | Notes |
| --- | --- | --- |
| template\_id | uuid FK → templates | Composite PK with department\_id |
| department\_id | uuid FK → departments |  |

**`template_fields`**: where text and signature are drawn

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| template\_id | uuid FK → templates |  |
| field\_type | enum | One value per thing drawn (FR-TPL-2). System values: `full_name`, `id_number`, `employee_number`, `address`, `landline`, `mobile`, `age`, `job_title`, `employment_status`, `job_percent`, `work_days`, `work_hours`, `study_fund`, `date`; pension: `pension_has_fund`, `pension_no_fund` (checkbox ticks), `pension_fund_name`; employee input: `email_input`, `no_email_checkbox`, and general `checkbox` / `text` (later documents); signatures: `signature` (employee), `employer_signature` |
| page | int | From 1 |
| x, y, width, height | numeric(7,2) | PDF points, from the bottom-left corner of the page's visible area (CropBox) |
| font\_size | int NULL |  |
| label | varchar(255) NULL | Text of a general checkbox or text field |
| is\_required | boolean | System values: true = an empty value means "Missing data"; false = may stay empty, drawn blank (FR-TPL-6) |
| show\_when | enum `always` / `no_email_chosen` | For `signature` positions: `always`, or only when the employee chose "no email" (FR-SGN-10). Default `always` |
| options | jsonb NULL | Field settings, e.g. the pension source `{ "pensionSource": "a_then_b" \| "b_only" }` (FR-TPL-5) |
| sort\_order | int |  |

**`rounds`**: send rounds

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| name | varchar(150) |  |
| mode | enum `single_template` / `by_department` |  |
| requires_signature | boolean | Default true. False = delivery-only round (later) |
| status | enum `draft` / `sending` / `active` / `closed` / `cancelled` |  |
| reminders\_enabled | boolean |  |
| reminder\_interval\_days | int | Default 3 |
| max\_reminders | int | NULL = no limit (default) |
| link\_expires\_at | timestamptz NULL |  |
| created\_by | uuid FK → users |  |
| sent\_at, closed\_at | timestamptz NULL |  |

**`round_templates`**: which PDF each department gets in a round

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| round\_id | uuid FK → rounds |  |
| department\_id | uuid FK → departments NULL | NULL = everyone (one-template mode) |
| template\_id | uuid FK → templates |  |
|  | UNIQUE (round\_id, department\_id) NULLS NOT DISTINCT | PostgreSQL 15+; stops two NULL rows in one round |

**`assignments`**: one employee in one round

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| round\_id | uuid FK → rounds |  |
| employee\_id | uuid FK → employees |  |
| department\_id | uuid FK → departments | The employee's department **when the round was created**; never changes. Round filters and counts, the signed file folder and the ZIP folders use it, not the employee's current department |
| template\_id | uuid FK → templates NULL | NULL for an external report (later) |
| source\_file\_key | text NULL | Ready per-employee PDF, e.g. Har Gal (later) |
| status | enum `pending` / `sent` / `opened` / `signed` / `signed_manual` / `delivered` / `missing_data` / `no_email` / `invalid_email` / `cancelled` | `delivered` is used only by delivery-only rounds (later) |
| field\_values | jsonb NULL | The values filled into the document, saved when the assignment is sent (FR-RND-8), including the age on that day and the employer-signature image key. Personal data: see NFR-PRV-6 |
| failed\_attempts | smallint | Wrong ID attempts |
| locked\_at | timestamptz NULL | Set at 5 attempts; cleared on unlock |
| sent\_at, first\_opened\_at, last\_reminder\_at, signed\_at | timestamptz NULL |  |
| reminder\_count | smallint |  |
| sign\_method | enum `digital` / `manual` / `kiosk` NULL |  |
| signed\_file\_key | text NULL | `rounds/<round_id>/<department_code>/<employee_number>.pdf`; department = `department_id` above (at send time). Storage keys are ASCII only (ids and numbers); the Hebrew name appears only in the download file name and in the ZIP |
| signed\_file\_sha256 | char(64) NULL | Proves the file hasn't changed |
| signer\_ip | inet NULL |  |
| signer\_user\_agent | text NULL |  |
| handled\_by | uuid FK → users NULL | Manual scan or kiosk |
| cancelled\_at | timestamptz NULL |  |
|  | UNIQUE (round\_id, employee\_id) | Once per round |

**`email_messages`**: every email, with its link token

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| assignment\_id | uuid FK → assignments |  |
| type | enum `invite` / `reminder` / `signed_copy` |  |
| to\_email | varchar(255) | Address actually used |
| token\_hash | char(64) UNIQUE NULL | SHA-256 of this email's link token; NULL for the signed copy |
| provider\_message\_id | varchar(255) NULL | Matches bounce notices |
| status | enum `queued` / `sent` / `delivered` / `bounced` / `failed` |  |
| error | text NULL |  |
| sent\_at | timestamptz NULL |  |

**`assignment_responses`**: what the employee chose or wrote (MVP: the email section)

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| assignment\_id | uuid FK → assignments |  |
| key | varchar(50) | `email_choice` (`email` / `office`), `email` (the address given), or a general field's key (later documents) |
| template\_field\_id | uuid FK → template\_fields NULL | Set for general checkbox / text fields; NULL for the email section |
| value | text | `true` / `false`, a choice, or free text |
|  | UNIQUE (assignment\_id, key) | One answer per key |

**`audit_log`**: activity log, append only

| Field | Type | Notes |
| --- | --- | --- |
| id | bigserial PK |  |
| user\_id | uuid FK → users NULL | NULL for employee or system |
| actor\_type | enum `user` / `employee` / `system` |  |
| action | varchar(50) | e.g. `round.send`, `assignment.sign`, `document.view` |
| entity\_type | varchar(50) |  |
| entity\_id | uuid NULL |  |
| details | jsonb |  |
| ip | inet NULL |  |
| created\_at | timestamptz |  |

**`settings`**

| Field | Type | Notes |
| --- | --- | --- |
| key | varchar(100) PK | e.g. `reminder_interval_days`, `link_expiry_days`, `sender_name`, `employer_signature` (`{ fileKey, uploadedAt }`, FR-ADM-2) |
| value | jsonb |  |
| updated\_by | uuid FK → users NULL |  |

**`sessions`**: staff login sessions

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| user\_id | uuid FK → users |  |
| token\_hash | char(64) UNIQUE | SHA-256 of the cookie token; the token itself is never stored |
| expires\_at | timestamptz | Absolute limit: login + 12 hours |
| last\_used\_at | timestamptz | Idle limit: + 30 minutes; extended on use |
| ip | inet NULL |  |
| user\_agent | text NULL |  |

**`login_attempts`**: login attempts for the failed-login limit

| Field | Type | Notes |
| --- | --- | --- |
| id | bigserial PK |  |
| email | varchar(255) | Lowercased, as typed; may belong to no user |
| ip | inet NULL |  |
| created\_at | timestamptz |  |

Rows of `sessions` and `login_attempts` are short-lived and deleted (logout, expiry, successful login, daily cleanup); nothing references them.

### Relationships

| From | To | Type | Meaning |
| --- | --- | --- | --- |
| departments | employees | 1:N | Each employee belongs to one department |
| templates | departments | M:N via `template_departments` | A PDF can serve several departments |
| templates | template\_fields | 1:N | Field positions per PDF |
| templates | templates | 1:N (self) | Versions |
| rounds | round\_templates | 1:N | Which PDF each department gets in the round |
| rounds | employees | M:N via `assignments` | The core of the system |
| departments | assignments | 1:N | The employee's department at send time (snapshot) |
| templates | assignments | 1:N | Each assignment uses one PDF |
| assignments | email\_messages | 1:N | Invite, reminders, copy; each with its own link |
| assignments | assignment\_responses | 1:N | The employee's answers (email section; checkbox and text fields) |
| users | rounds, templates, import\_batches, audit\_log | 1:N | Who created or did what |
| users | sessions | 1:N | Staff login sessions |
| import\_batches | employees | 1:N | Last import that touched each employee |

### Indexes and rules

- `employees(employee_number)` and `employees(id_number)` UNIQUE; `departments(code)` UNIQUE.
- `assignments(round_id, status)` for round counts; `assignments(round_id, department_id)` for the round's department filter and counts; `assignments(employee_id)` for history.
- `assignments(status, last_reminder_at)` for the reminder job.
- `email_messages(token_hash)` UNIQUE for link lookup; `email_messages(provider_message_id)` for bounces.
- `audit_log(entity_type, entity_id)` and `audit_log(created_at)`.
- `sessions(token_hash)` UNIQUE for cookie lookup; `sessions(user_id)`.
- `login_attempts(email, created_at)` and `login_attempts(ip, created_at)` for the login limit.
- `ON DELETE RESTRICT` everywhere: employees and templates with signed documents are archived, never deleted. Exception: `sessions` and `login_attempts` rows are deleted.

## 13. Non-functional requirements

The data includes ID numbers and signed employment documents, so security and proof of signing come first; the load is small.

### Security: signing links

- NFR-SEC-1: Link tokens are random, 256 bits. Only their SHA-256 hash is stored.
- NFR-SEC-2: URLs and emails carry no ID numbers. The email shows only the employee's name, the document name, the link and its expiry date.
- NFR-SEC-3: ID check uses a constant-time comparison, locks at 5 wrong attempts per assignment, has a rate limit per IP address, and logs every attempt.
- NFR-SEC-4: The signing session is a short-lived cookie (15 minutes, `httpOnly`, `Secure`), cleared when the browser closes.
- NFR-SEC-5: After signing, every link of the assignment shows only "Already signed".

### Security: proof of signing

- NFR-SIG-1: The signed PDF is flattened so it can't be edited, with a footer line: date, time and reference number.
- NFR-SIG-2: The system stores the file's SHA-256 hash, time, IP address and browser details, in `assignments` and `audit_log`.
- NFR-SIG-3: The signature image is checked before use: PNG only, maximum size, not empty.
- NFR-SIG-4: The employee's answers (email section) are part of the proof: drawn into the signed PDF before it is flattened and hashed, stored in `assignment_responses` in the same transaction as the signature, and recorded in the signing row of `audit_log` (the choice only, not the email address).

### Security: staff and data

- NFR-SEC-6: Passwords are hashed with Argon2. Session cookies are `httpOnly`, `Secure`, `SameSite=Strict`, and end when the browser closes. Sessions are stored in the database (token hash only) and end after 30 minutes of inactivity or 12 hours after login. Login allows 5 failed attempts per email (20 per IP address) in 15 minutes, then answers "too many attempts". Wrong email, wrong password and disabled user get the same answer.
- NFR-SEC-7: Role checks run on the server for every endpoint.
- NFR-SEC-8: Storage is private. Signed files are reached only through links that expire within minutes, after a permission check. Each view is logged.
- NFR-SEC-9: Uploads accept only PDF and Excel, plus PNG for the employer signature image, with size limits, and the file content is checked, not just its name.
- NFR-SEC-10: Excel exports neutralize cells starting with `=`, `+`, `-` or `@`.
- NFR-SEC-11: HTTPS everywhere; database and storage are encrypted at rest.

### Privacy

- NFR-PRV-1: All data is stored in an Israel cloud region.
- NFR-PRV-2: Daily backups with point-in-time restore.
- NFR-PRV-3: A retention policy for signed documents and logs, agreed with HR. It also covers the stored Excel imports (`imports/` in storage): they hold ID numbers and are kept even when a preview is never confirmed.
- NFR-PRV-4: Requirements under Israeli privacy law and its data security regulations are checked with a legal or privacy advisor before launch.
- NFR-PRV-5: If the email provider is outside Israel, the email content (name, link, signed copy) passes through it. This must be accepted, or an Israel-region provider chosen.
- NFR-PRV-6: The extra employee details (address, birth date, phones, role, job terms, funds) appear only on the employee card and in documents. They are never in lists, URLs, emails or the status export. The audit log records the birth date only as "changed", like the ID number.
- NFR-PRV-7: `assignments.field_values` is a copy of personal data (ID number, address, the age worked out from the birth date, phones and more). It is **never** written to logs, the audit log, lists, URLs or emails; it appears only in the document itself (view, print, signed PDF). The audit log records only that the values were saved, never the values.

### Performance and reliability

| Area | Requirement |
| --- | --- |
| Bulk sending | A full round of 1,500 emails goes through the queue in batches, within the provider's rate limits. SES production access is requested early. |
| Reminders | The daily job is safe to run twice and runs as one copy at a time. |
| PDF | The personalized PDF opens in under 2 seconds. The Hebrew font is loaded once. |
| Screens | Lists are paged; round counts come from indexed `GROUP BY` queries. |
| ZIP | Streamed from storage, never held whole in memory. |
| Availability | Single region, one small server; a short outage only delays signing, nothing is lost. |

### Hebrew and right to left

- **NFR**-HEB-1: The whole interface is Hebrew, right to left, including dates (DD/MM/YYYY) and error messages.
- NFR-HEB-2: Emails are Hebrew HTML with `dir="rtl"`.
- NFR-HEB-3: Text drawn on PDFs uses an embedded Hebrew font and right-to-left ordering. Testing includes names that mix Hebrew, numbers and hyphens, addresses with house numbers ("הרב קוק 12, בני ברק"), phones, and an email address (left to right inside a right-to-left line).
- NFR-HEB-4: File names in the ZIP use UTF-8 so Hebrew names open correctly in Windows.

### Usability for employees

- NFR-USE-1: Signing works in current Chrome, Edge and Firefox on Windows, and is tested at common filtered-internet setups.
- NFR-USE-2: The signature pad is at least 500 × 200 pixels on a computer screen, and smooths mouse lines.
- NFR-USE-3: The flow takes at most 4 screens, with large buttons and plain Hebrew.

### Email delivery

- [ ] NFR-DEL-1: SPF, DKIM and DMARC on a dedicated sending subdomain.
- [ ] NFR-DEL-2: The domain and sender are whitelisted with NetFree, Etrog, Nativ and Rimon before launch.
- [ ] NFR-DEL-3: Emails are short, light on images, with one clear link.

## 14. Risks, open questions and acceptance

The biggest risk to launch is not the code but internet filters blocking the signing page; that work starts now.

### Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Internet filters block the site, links or attachments | Many employees can't sign | Whitelist with NetFree, Etrog, Nativ and Rimon early; test with a filtered account before launch; office signing station as fallback |
| Emails land in spam or are held | Low signing rate | SPF/DKIM/DMARC, dedicated subdomain, short emails |
| Hebrew text appears reversed or broken in the PDF | Wrong documents | Embedded font, bidi ordering, tests with mixed names |
| Many employees have no email | Heavy manual work | Office signing station, print and scan flow |
| Email provider starts with low sending limits | Slow first round | Request production access early |
| Bad data in the Excel file | Wrong department PDF or missing emails | Preview with checks before saving |
| Many employees miss a required value (address, mobile) | Many contracts held as "Missing data" | Recipient preview lists who is missing what before sending; positions that may stay empty (landline); fix in Har Gal and re-import |

### Assumptions

- Each contract is a separate template, converted to PDF with Print to PDF. The organization's details (עץ הדעת) are printed in the PDF. All three below have the email section (FR-SGN-9), one drawn signature placed in every signature position (FR-SGN-10), and the employer signature already on the document when sent (`pre_signed`):
  - **Substitute (ממלאת מקום):** from the system: name, ID, address, mobile, landline, age, pension fund choice (FR-TPL-5, "א, then ב"). The **landline position may stay empty**, since many employees have no landline; name, ID, address and mobile stay required. The contract period is a general clause in the document (no dates, no set hours), so no date fields. The employee declaration section is signed with her signature.
  - **Kindergarten teacher (גננת):** from the system: date drawn up and signed, employee number ("for system use"), name, ID, address. Email section in section E.
  - **Paramedical (פרא רפואי):** from the system: date drawn up and signed, name, ID, address. Email section in section 6.
- A simple drawn signature is legally enough for these documents (confirmed by the organization).
- The Excel file includes an employee number for every employee; it is unique and never reused (confirmed).
- Managers and officers work from a computer with normal internet access.

### Open questions

- [x] Employee number: present for every employee, unique, never reused. It is the import match key.
- [x] Employees missing from a new Excel file: left as they are (exports may be filtered by department); deactivation is manual only.
- [x] Reminders: every 3 days until signed, no maximum; they stop when the link expires or the manager cancels.
- [x] Link expiry: 60 days by default, changeable per round; resending gives a fresh link.
- [x] Filter companies: NetFree, Etrog, Nativ, Rimon.
- [ ] Cloud provider (AWS or Azure): decide before the deployment phase. Development runs locally in Docker, and storage and email sit behind adapters, so either works.
- [ ] Har Gal export format: unknown; the later phase keeps all options open.
- [ ] After-school contract (צהרונית / סייעת צהרון): fields not decided yet. Nothing is built for it now; when it is, its pension field uses "ב only" (FR-TPL-5).
- [ ] Lawyer: confirm that one drawn signature placed by the system in several positions (main signature, employee declaration, the "no email" line) is acceptable.
- [ ] Fund columns (קוד קופ"ג א, קוד קופ"ג ב, קוד קרן השתלמות): the sample holds the fund's name (letters only). Confirm with a full real export that they always hold the name; if a numeric code ever appears, add a code → name list then.

### MVP acceptance criteria

- [ ] A manager imports a 1,500-row Excel file; the preview shows correct new, updated and error counts.
- [ ] A round sent to all employees delivers each one their own department's PDF, with the correct name and ID number.
- [ ] A round can be sent to one department, to hand-picked employees and to a single employee.
- [ ] An employee signs with a mouse on a Windows computer in under 3 minutes; the signed PDF shows the drawn signature.
- [ ] The signed PDF is saved in the right department folder and emailed to the employee.
- [ ] 5 wrong ID attempts lock the link; a manager can unlock it.
- [ ] Reminders go out every 3 days and stop after signing.
- [ ] A bounced email changes the status to "Invalid email".
- [ ] An officer can view statuses and signed documents but can't send or edit.
- [ ] Hebrew names with numbers and hyphens appear correctly in the PDF.
- [ ] A substitute contract shows the right name, ID, address, phones, age and pension fund choice; an employee with no landline still gets it.
- [ ] An employee missing a required value (for example no address) is sent nothing and appears in manual handling; after the card is filled in, one click sends it.
- [ ] The employee can't sign without choosing exactly one email-section option; the answer appears in the signed PDF, the round screen and the Excel export, and a corrected email shows in manual handling.
- [ ] The employer signature is on the contract the employee views, before she signs.
- [ ] The signing page opens through at least one common filtered-internet service.
