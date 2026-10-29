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

The MVP covers one document type: a department PDF (an employment contract) that the system fills with the employee's details, plus boxes the employee fills in (the email section, and any other boxes the manager places on the template) and a drawn signature. Everything else is designed for but built later.

### In the MVP

- Three roles: manager, officer, employee.
- Excel import with a fixed column format: preview, checks, new employees added, existing employees updated. Besides the required columns it reads optional extra details (address, birth date, role, job %, pension fund and more) and two phones.
- One ready PDF per department, with set positions for the values the system fills in (name, ID number, address, phones, age, pension fund choice, date and more), the employee's signature (in one or more places), and the employer's (עץ הדעת) signature.
- The values are saved with each assignment when it is sent; an employee with a missing required value is not sent the document until the manager fills it in, unless the template lets the employee fill that value in herself (FR-TPL-10).
- Boxes the employee fills in, chosen by the manager per template (FR-TPL-9, FR-TPL-10): short text, long text, choose from a list, checkbox, date and drawing (for example initials). For each box: who fills it in (system only, employee only, or system and the employee when empty), required or optional, shown only when another box has a certain value, limits, and whether it needs manager approval after signing. Answers are saved in `assignment_responses`. Plus the email section (keep or correct the email, or "no email, notices at the office"), the same in every contract.
- Manager approval of signed documents whose answers need it (FR-TRK-6): approve, or return for correction and send again.
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
| Employee notice and hearing notice (checkbox acknowledgment) | New form type | All box types, box settings and `assignment_responses` (MVP, FR-TPL-9, FR-TPL-10) |
| Custom employee details (see below) | Not needed for launch | Box `key` and `assignment_responses.key` are plain text, not a fixed list; system values are looked up by name in one shared list, so a custom detail is one more source; "system, and the employee when empty" works for any value; the box types (text, date, checkbox, list) match the detail types; manager approval and its log rows (FR-TRK-6) |
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

**Custom employee details (later):** a manager adds new employee details in the settings: a Hebrew name, a type (text, number, date, yes/no or list), required or not. A detail can be archived, never deleted. Custom details appear on the employee card and can be placed on a template like any system value, including "system, and the employee fills it in when empty". When the employee fills one in, the manager can choose "copy to the employee card" (with approval, logged), so future documents fill it in automatically. Values are stored in a separate table (`employee_custom_values`: employee, detail, value), never as new columns on `employees`. The Har Gal import can map a column to a custom detail by its exact header name. Nothing in the MVP may block it: box keys and `assignment_responses.key` stay open text, and a template field can later point to a custom detail (`field_type` `custom_detail` + `template_fields.custom_detail_id`) without changing existing rows.


## 5. Core ideas and status model

Everything is tracked per **assignment**: one employee in one send round. That is what lets one employee be in several rounds at once, each with its own status.

| Term | Meaning |
| --- | --- |
| Send round (סבב שליחה) | One document sent to a chosen group of employees, tracked on its own. For example "Annual contract 2027". |
| Round mode | **One template** for everyone in the round, or **by department**: each employee gets the PDF linked to their department. |
| Assignment | One employee in one round: which PDF they get, the values filled into it (saved when it is sent), their answers, their status, their signed file. |
| Template | A department's ready PDF plus the positions of every value the system fills in, the boxes the employee fills in (with their settings), the employee's signature and the employer's signature (FR-TPL-2, FR-TPL-10). |
| Box | One thing drawn on the document, identified by its `key` inside the template. It may appear at several positions (one answer, drawn at each). The manager sets who fills it in, required or optional, when it is shown, its limits and whether it needs approval (FR-TPL-10). |
| Field values | The employee's details as filled into the document, saved with the assignment when it is sent (FR-RND-8). The employee views and signs exactly these. |
| Responses | What the employee chose, wrote or drew on the signing screen (the email section and every box she fills in), saved with the assignment (`assignment_responses`, one row per box). |

### Assignment statuses

| Status (Hebrew) | Set when |
| --- | --- |
| Waiting to send (ממתין לשליחה) | The round was created, or sent and its email is in the queue. In a sent round, a "Waiting to send" row whose invitation failed shows as "Send failed" (שליחה נכשלה) until it is resent. |
| Sent (נשלח) | The email provider accepted the invitation. |
| Opened (נפתח) | The employee entered a correct ID number. |
| Signed (נחתם) | The employee signed digitally. |
| Signed manually (נחתם ידנית) | A manager uploaded a scan of a paper signature. |
| Delivered (נמסר) | Delivery-only round (later): the email provider accepted the email. No  signature needed. |
| Missing data (חסרים פרטים) | A required value for the document is empty on the employee card (for example no address). Nothing is sent; needs manual handling (FR-MAN-1). Takes precedence over "No email". |
| No email (אין מייל) | The employee has no email address; needs manual handling. |
| Invalid email (מייל שגוי) | The email provider refused the address or the email bounced; needs manual handling. |
| Cancelled (בוטל) | A manager cancelled the round or this employee, or returned the signed document for correction (FR-TRK-6; shown and counted as "Returned for correction" (הוחזר לתיקון), apart from ordinary cancellations). |

Four more conditions show on screen but are **flags, not statuses**, so the status isn't lost when they clear:

- **Locked (נעול):** 5 wrong ID attempts. A manager can unlock it (at most twice per assignment, FR-SGN-2), and the employee returns to their previous status.
- **Expired (פג תוקף):** the link expiry date passed before signing. Worked out from the date, not stored.
- **Send failed (שליחה נכשלה):** a "Waiting to send" row in a sent round whose newest invitation failed; it clears when the email is resent. Counted and filtered like a status.
- **Waiting for approval (נחתם, ממתין לאישור):** the document is signed and at least one answer is in a box marked "needs manager approval", and no manager has approved it yet (FR-TRK-6). Worked out from the data; the status stays "Signed".

"Opened" means the employee entered their ID, not that the email was opened. Email-open tracking is unreliable, and filtered email makes it worse.

## 6. Functional requirements

All requirements below are MVP. Each has an ID so the team can link tasks and tests to it.

### Employees and Excel import

| ID | Requirement |
| --- | --- |
| FR-EMP-1 | A manager can upload the **Har Gal employee export** (`.xlsx`) as it is. Columns are found by these exact Hebrew headers, in any order; all other columns are ignored: מספר עובד, תעודת זהות, שם פרטי, שם משפחה, מחלקה, E-Mail, קידומת, טלפון, נייד פרטי - קידומת, נייד פרטי - מספר. A missing required header fails the whole file. Employee number and ID number may arrive as numbers: they are read as text, and the ID number gets its leading zeros back. The department cell is "code - name" (for example "15 - ממלאות מקום ירושלים"). Two phones (FR-EMP-9). An empty E-Mail means "No email". **Optional extra columns**, read by these exact headers when present (a missing one doesn't fail the file): כתובת, יישוב, תאריך לידה, תאור תפקיד, מעמד, אחוז משרה, ימי עבודה, שעות עבודה, קוד קופ"ג א, קוד קופ"ג ב, קוד קרן השתלמות. תאריך לידה arrives as an Excel date cell (a date is accepted for this column only); אחוז משרה arrives as a number; שעות עבודה arrives as a whole number that is a **full-time base code**, not a number of hours (1 = 42 hours a week, 3 = 30, 4 = 40; 0 and other codes are unknown and kept as they are, section 14); ימי עבודה is text. The three fund columns hold the fund's **name** as text (letters only in the sample), stored trimmed, with no code list (section 14). Salary and balance data is never imported; every other column is ignored. |
| FR-EMP-2 | Before saving, the system shows a preview: new, updated, unchanged and rows with errors (with the reason per row), plus new departments and **renamed departments** (known code, different name). Each updated employee lists every change as **"field: old → new"**, including changes that overwrite a manual edit (FR-EMP-4). |
| FR-EMP-3 | Checks: valid Israeli ID number (check digit), no repeated employee numbers or ID numbers in the file, an ID number not already used by another employee, the email format when present, and a department cell in the form code - name: digits, optional spaces, "-", optional spaces, name. It is split at the **first** hyphen only, because names can contain hyphens and numbers ("45 - ממלאות מקום אלעד-45"). The code must be a whole number above 0, and the name must not be empty. A bad cell makes that row an error. A wrong email format is **not** an error: the row is imported with email status `invalid` (FR-EMP-4) and listed as a warning with its row number, so the employee still appears in manual handling. A phone that can't be read is saved empty, also as a warning. An extra-column cell that can't be read (a birth date that isn't a date or is in the future, a job % that isn't a number from 0 to 100, an hours-base code that isn't a whole number, text that is too long) is a warning too: that value is not written and the row is still imported. |
| FR-EMP-4 | On confirm, rows are matched by **employee number**: new numbers create employees, existing numbers update them. Employees missing from the file are left as they are, because payroll exports may be filtered by department. A manager can mark an employee inactive by hand. **Har Gal is the main source:** an import overwrites the fields it carries, including manual edits (FR-EMP-7). Email status: same email as stored → status kept as it is (a bounced email stays bounced); different email → `valid`, or `invalid` if the format is wrong; empty → `missing`. **Extra columns** (FR-EMP-1): an empty cell, or a column missing from the file, never erases a stored value; only a filled cell overwrites it. The 10 required columns keep the rules above. The preview shows every change, including the extra fields, as "field: old → new". An import never sends anything (FR-EMP-6). |
| FR-EMP-5 | Departments are matched by **code**, not by name. New codes in the file are created during import, after the manager confirms them. A known code with a different name renames the department on confirm (shown as "department renamed" in the preview). |
| FR-EMP-6 | Employees without a valid email are marked "No email" and appear in manual handling. When an import adds an email, **nothing is sent automatically**: the employee's open assignments in status `no_email` appear in manual handling as "email added, ready to send", and the manager sends them with one click (FR-MAN-1). This protects rounds already sent: a draft round that was never sent emails everyone who has a valid email when the manager sends it (the send is the manager's action). |
| FR-EMP-7 | A manager can add or edit a single employee (for example, fix an email), including the extra fields (address, city, birth date, role, employment status, job %, work days, work hours base code, pension funds א and ב, study fund) and both phones. The card also shows the age, and the hours base as "42 שעות" for a known code (otherwise the code itself). The next import overwrites these edits with the Har Gal data (FR-EMP-4), so managers should make the same fix in Har Gal. |
| FR-EMP-8 | Every import is recorded: who, when, file, and counts. |
| FR-EMP-9 | Two phones, stored separately as `050-1234567` (a prefix that lost its leading 0 gets it back): **landline** = קידומת + טלפון, **mobile** = נייד פרטי - קידומת + נייד פרטי - מספר. Nothing is ever sent to them; they are filled into documents. |

### Templates

| ID | Requirement |
| --- | --- |
| FR-TPL-1 | A manager can upload a PDF, name it and link it to one or more departments. |
| FR-TPL-2 | Each template stores positions (page, X, Y, size) for what is drawn on it. In the MVP the developer sets these once per PDF. Any type can appear in any number of positions, or not at all. **System values:** full name, ID number, employee number, address ("כתובת, יישוב"), landline, mobile, age (whole years from the birth date, on the day the assignment is sent), role, employment status, job %, work days, study fund; pension fund (FR-TPL-5); document date ("drawn up and signed": today's date while the employee views the document, the signing date in the signed PDF; DD/MM/YYYY, Asia/Jerusalem). **Boxes the employee fills in:** the email section (FR-SGN-9), and short text, long text, choose from a list, checkbox, date and drawing boxes (FR-TPL-9). A system value can also be filled in by the employee, per its settings (FR-TPL-10). **Signatures:** the employee's (FR-SGN-10) and the employer's (FR-TPL-7). The organization's own details (עץ הדעת) are part of the PDF itself, not fields. Work hours are **not** a system value yet: שעות עבודה is a base code whose meaning is not fully confirmed (section 14). |
| FR-TPL-3 | A manager can preview a template filled with a sample employee, to check the Hebrew text. The preview lists the values that sample employee is missing. |
| FR-TPL-4 | Once a template is used in a round (when the round is created, even before it is sent), it is locked, so a draft round sends exactly the document that was previewed. A change to its name, field positions or any box setting (FR-TPL-10: who fills it in, required, condition, limits, approval, label), or to its employer-signature setting, creates a new version (same PDF); documents already sent don't change. Linking or unlinking departments changes the locked template in place, since it only decides which template future rounds offer. |
| FR-TPL-5 | **Pension fund.** Two checkbox positions, "has an active fund" and "has no active fund", plus a position for the fund name. A setting on the template's pension field picks the source: **"א, then ב"** (default: קופ"ג א; if empty, קופ"ג ב; if both are filled, א) or **"ב only"** (after-school contracts, which always use קופ"ג ב). If the column(s) used have a name: "has an active fund" is ticked and the name is written; if empty: "has no active fund" is ticked. An empty fund is a valid answer, never "missing data". |
| FR-TPL-6 | Each box is **required** (default) or **may stay empty** (for example the landline, which many employees don't have). For a value filled in by the system only, a required value that is empty for an employee means "missing data" (FR-RND-4); an optional one is drawn blank. For "system, and the employee when empty", an empty value is never "missing data": the box goes to the signing form instead. For a box the employee fills in, required means she can't submit while it is empty (FR-SGN-4). A hidden box (FR-TPL-10) is never required. |
| FR-TPL-7 | **Employer signature** (עץ הדעת), a setting per template: **already on the document when sent** (the employee receives the document signed by the employer, then signs herself), **added after the employee signs** (only in the signed PDF), or **none**. The image is the one the manager uploaded (FR-ADM-2), placed at the template's employer-signature positions. |
| FR-TPL-8 | A template can be used in a round only when it is complete: at least one employee-signature position shown always (no condition); the email box and the "no email" checkbox come together; "has an active fund" and "has no active fund" come together; a template with an employer signature has at least one employer-signature position; every box the employee may fill in has a Hebrew label; a list has 2–30 options; every condition points to a checkbox, a list or the email choice on the same template that has no condition of its own, with a value that box can have; positions with the same key have the same type and settings; earliest date ≤ latest date; at most 5 drawing boxes; no position starts in the bottom 16 points of a page (y ≥ 16), where the signed PDF prints its footer line (FR-SGN-5). The template shows every reason it isn't ready. |
| FR-TPL-9 | **Boxes the employee fills in**, all in the MVP, any number per template (up to the 40 positions): **short text** (one line), **long text** (several lines, wrapped inside its box), **choose from a list** (options set per box by the manager), **checkbox**, **date**, and **drawing** (a separate small drawing pad, for example initials or a second signature; the main signature stays as in FR-SGN-10). Each answer is drawn into the PDF at its positions: text right to left in the same embedded font (an email or number inside it keeps its own direction), the chosen option as text, a tick for a checked checkbox, a date as DD/MM/YYYY, and a drawing as an image fitted into its box (aspect ratio kept). A box that is too small for its text uses a smaller font down to a minimum size; the text limit (FR-TPL-10) keeps it readable. Text the employee typed that still doesn't fit its box at the minimum size is refused before signing ("the text is too long for its place in the document"), so it never runs over the printed contract; the signing screen warns her while she types. |
| FR-TPL-10 | **Settings per box**, set by the manager per template: **(1) Who fills it in:** "system only", "employee only" or "system, and the employee when empty". Boxes from FR-TPL-9 are always "employee only". System values may use all three, except full name, ID number, employee number, age and document date, which are always "system only". With "employee only" the system value isn't used; with "system, and the employee when empty" the employee sees the box only when the saved value (FR-RND-8) is empty. **(2) Required or optional** (FR-TPL-6). **(3) Shown only when** another box has a certain value (for example a signature line shown only when "no email" was chosen, or a text box shown only when a checkbox is ticked). One condition per box; a hidden box isn't shown, isn't saved and isn't drawn. **(4) Limits:** maximum length for text (short text up to 500 characters, default 100; long text up to 2,000, default 1,000), the allowed options for a list, the earliest and latest date (a fixed date or "the signing day"). **(5) Needs manager approval after signing:** yes or no (default no; FR-TRK-6). The server checks every answer against the same rules as the signing screen. |

### Send rounds

| ID | Requirement |
| --- | --- |
| FR-RND-1 | A manager creates a round with a name and a mode: one template, or by department. |
| FR-RND-2 | Recipients can be chosen and combined: all employees, chosen departments, hand-picked employees, or one employee (also from the employee card). |
| FR-RND-3 | In by-department mode, the system picks each department's template and warns if a department in the round has none. |
| FR-RND-4 | Before sending, the system shows counts: will get email, no email, already signed this template in another round (skip or send again), and **missing data**, with a list of who is missing what (for example "address, mobile"). Only required values filled in by the system only count as missing; an empty value the employee may fill in (FR-TPL-10) is not. Employees with missing data are added to the round in status "Missing data" and nothing is sent to them until the manager fills in the employee card (FR-MAN-1). "Already signed" counts any version of the same template, signed digitally or on paper. Employees who still have the same document open in another round that can be signed (link not expired) are counted apart and left out, so nobody gets two emails for one document. Inactive employees are never added, even when picked by hand (they are counted and named). |
| FR-RND-5 | Per round: reminders on/off, reminder interval (default 3 days), link expiry (default 60 days, counted from the moment the round is sent: send time + days × 24 hours, shown as the Israeli date). Reminders continue until the employee signs; an optional maximum can be set. |
| FR-RND-6 | Sending runs in the background in batches; the round screen shows progress ("sent 640 of 1,220", from the round's invitations: queued, sent, failed). The round is "sending" until every invitation is sent or failed, then "active". |
| FR-RND-7 | A manager can cancel a round (also a draft) or a single recipient. Every open assignment becomes "Cancelled" and every link of it shows "cancelled" at once; signed documents stay as they are; emails still in the queue are not sent. The employees can get the same document in a new round right away. A signed document is returned for correction instead (FR-TRK-6). |
| FR-RND-8 | **Values are saved at send.** When an assignment is sent (also for "No email" assignments, so they can be printed), the system checks the required values again and saves the filled-in values with the assignment (`assignments.field_values`), including the age on that day and which employer-signature image is used. A required system-only value missing at that moment sets "Missing data" instead (no values are saved for it until it is sent from manual handling). An employee who became inactive after the round was created is cancelled at the send. Everything else is checked again too: details filled in since the round was created, or an email added or removed, count as they are at the send. An empty value of a "system, and the employee when empty" box is saved as empty, and the employee fills it in on the signing screen. The view, the print and the signed PDF all use the saved values; a later import or card edit doesn't change a document already sent. To change one, cancel it and send again. |

### Signing (employee)

| ID | Requirement |
| --- | --- |
| FR-SGN-1 | Each employee gets a unique link. The link shows no personal details until the ID number is entered. |
| FR-SGN-2 | The employee enters their ID number. 5 wrong attempts lock the assignment until a manager unlocks it. Unlocking clears the attempts; a manager can unlock one assignment at most twice (each unlock gives whoever is typing 5 more tries), and not after the link expired. After that the employee is handled at the office: print and upload the scan (FR-MAN-2, FR-MAN-3); the office signing station only while the assignment can still be unlocked (FR-MAN-4: a locked row is unlocked first). A locked assignment gets no reminder or resend until it is unlocked. |
| FR-SGN-3 | The employee sees their personalized PDF (the saved values filled in, FR-RND-8; the employer signature if the template has it "already on the document") and must scroll to the end before signing. |
| FR-SGN-4 | Before the signature pad, the employee fills in a short form: the boxes she fills in (FR-TPL-9, FR-TPL-10) and the email section (FR-SGN-9), in the template's order, each with a clear Hebrew label. Boxes with a condition appear and disappear as she answers. Each mistake shows a Hebrew error next to its box (required box empty, text too long, date out of range); she can't submit with a required box empty. A drawing box has its own small pad with Clear. Then she draws a signature with the mouse (touch also works), can clear and redraw, and confirms a reading statement. The form and the pad are on one screen (B3), so the flow stays within 4 screens (NFR-USE-3). If the document was returned for correction (FR-TRK-6), a short box at the top of this screen shows "תיקון נדרש: <the manager's note>", only after the ID check. |
| FR-SGN-5 | On confirm, the system checks every answer again with the same rules (FR-TPL-10), then places the signature (FR-SGN-10), the date, the employee's answers (FR-TPL-9, FR-SGN-9) and, if set, the employer signature ("added after the employee signs") in the PDF, locks the file against edits, and adds a small line with the signing date, time and reference number. |
| FR-SGN-6 | The signed PDF is saved under round / department (at send time, `assignments.department_id`) / employee, and a copy is emailed to the employee at the address the link was sent to (never to an address the employee typed in the email section, and also when she chose "no email, at the office": the link proves she reads that mailbox). At the office signing station no link is used: see FR-MAN-4. |
| FR-SGN-7 | After signing, the link only shows "Already signed". Expired, cancelled and locked links show a clear Hebrew message with HR contact details. |
| FR-SGN-8 | The signing session ends 15 minutes after the correct ID number (fixed, not extended by use) or when the browser closes. It opens only the link it was started on. If it ends while she is still filling in the form, the screen keeps her answers and signature, asks for the ID number again and sends them; nothing is saved before. |
| FR-SGN-9 | **Email section** (the same in every contract). The employee must choose exactly one: (a) **an email**: the box is pre-filled with the email the system has; she can keep or correct it; or (b) tick **"I have no email and want my payslip and notices at the institution's office in my city"**. She can't sign without choosing one. Checks: valid email format, at most 254 characters, exactly one option. The answer is saved with the assignment (`assignment_responses`), drawn into the signed PDF, shown to managers and officers, and included in the Excel export. A corrected email **never** overwrites the employee's stored email; it shows in manual handling (FR-MAN-1) so it can be fixed in Har Gal. |
| FR-SGN-10 | **One drawn signature, several positions.** The employee draws once; the system places that drawing at every employee-signature position of the template. Each position is shown **always** (the main signature, the employee declaration) or only under a condition (FR-TPL-10), for example **"only if (b) no email was chosen"** (the signature line under that option). Drawing boxes (FR-TPL-9) are separate drawings, not this signature. |

### Reminders and email

| ID | Requirement |
| --- | --- |
| FR-REM-1 | A daily job sends reminders to recipients in Sent or Opened status whose last email was at least the reminder interval ago, counted in calendar days in Israel (an email on Sunday at any hour is due again on Wednesday with a 3-day interval). It runs at 09:00 Sunday to Thursday and sends nothing on the no-reminder dates a manager sets (for example Yom Tov, FR-ADM-2); those reminders go on the next run. A manager's own reminders (FR-REM-3) are not affected. |
| FR-REM-2 | Reminders stop only when the employee signs, the link expires or the manager cancels. There is no maximum by default. |
| FR-REM-3 | A manager can send a reminder now, to one employee or to everyone who hasn't signed in a round. Only employees in Sent or Opened status get one, at their current valid email, with a new link (the older links keep working). Against flooding: one employee can't be reminded while an email to her is still on its way, or within 1 hour of the last one; "remind everyone" skips the locked, those with no valid email, those with an email on its way and those emailed in the last 24 hours, and shows how many were skipped and why. A manual reminder ignores the round's "reminders on/off" and maximum (they are for the daily job) but counts in the reminders sent. |
| FR-REM-4 | Bounced emails change the status to "Invalid email". A hard bounce (the address will never work) marks that email bounced, the employee's email status "bounced" (only if her stored email is still that address, so a fixed address isn't marked bad by a late notice), and each of her open assignments (pending, sent or opened) whose newest invitation or reminder went to that address "Invalid email"; an assignment emailed since at another address stays as it is. Signed, paper-signed and cancelled assignments never change (a bounced signed copy marks only that email). A soft bounce (mailbox full, server busy) changes nothing and is only logged: the provider retries and the next reminder is another try. Reminders then stop for that row; the link she already has still works, and resend needs a new address. |
| FR-REM-5 | Every link sent (invitation or reminder) keeps working until the employee signs, the link expires or the manager cancels (then every link of that assignment shows "cancelled"). |

### Tracking

| ID | Requirement |
| --- | --- |
| FR-TRK-1 | The dashboard shows totals across active rounds: signed, waiting, opened, no email, and signed documents waiting for approval (FR-TRK-6). |
| FR-TRK-2 | The round screen lists every recipient with status, last update and reminders sent; filters by status (including "waiting for approval" and "returned for correction") and department (at send time); search by name, employee number or ID (the search text is sent in the request body, never in a URL). For signed employees it also shows the email-section answer: "email" or "at the office", the email given, and whether it differs from the system email; and an answers panel with every box she filled in (text, chosen option, checkbox, date; a drawing through a short-lived link). Opening the panel is logged, and so is a page of the list that shows email addresses employees gave. |
| FR-TRK-3 | Managers and officers can open any signed document. Each view is logged. |
| FR-TRK-4 | Export a round's statuses to Excel, including the email-section answer (choice, email given, differs from the system email) and one column per box the employee fills in (header = the box label): the text, chosen option, "כן" / "לא" for a checkbox, the date as DD/MM/YYYY, and "צויר" (drawn) for a drawing. Boxes that come from a system value ("system, and the employee when empty" or "employee only" on a system value) show only "מולא ע"י העובד" (filled in by the employee), never the value (NFR-PRV-6). Every cell is formula-safe (NFR-SEC-10). The export never has the ID number (it protects every signing link; the employee number identifies the row). Also download all signed files as a ZIP in department folders (department at send time): the current signed documents only (signed and signed manually; a document returned for correction opens on its own, FR-TRK-3). A file missing in storage is left out and listed in a Hebrew note file inside the ZIP. One ZIP at a time per user. |
| FR-TRK-5 | The employee card shows the employee's history across all rounds. |
| FR-TRK-6 | **Manager approval.** A signed document with at least one answer in a box marked "needs manager approval" shows as **"Signed, waiting for approval"** (a flag, section 5). Managers and officers see a list of them (across rounds) and exactly what the employee filled in. Only a manager can act: **Approve** (logged; the flag clears), or **Return for correction** with a required note (up to 500 characters; logged): the assignment is cancelled and shown as "Returned for correction", and the signed PDF stays stored as proof. "Send again" then creates a **correction round**: a one-employee round with the newest version of the same template and the default settings, named automatically "תיקון: <original round name> – <first last>", linked to the original assignment (one correction round per returned assignment), and sent at once. In the original round the row shows "returned for correction → sent again in round X" with a link, and its counts show "returned for correction" apart from ordinary "cancelled"; the correction round links back to the original. The note is shown to the employee on the signing screen of the new document, after the ID check (FR-SGN-4), and never in the email: the email only says a corrected document is waiting. Approving never changes the signed PDF. If the employee is no longer active, or the newest version of the template is archived or not ready, "Send again" is refused and the row stays "Returned for correction" until it can be sent (or the manager sends the document in a new round). The signed copy is emailed at signing as usual, before any approval. Manual scans store no answers and never wait for approval. |

### Manual handling

| ID | Requirement |
| --- | --- |
| FR-MAN-1 | A list of everyone with no email or a bounced email, across rounds. Open assignments in status `no_email` whose employee now has a valid email (for example, added by an import) are marked **"email added, ready to send"**, with a one-click send (a new invitation with a new link). The list also shows: open assignments in status **"Missing data"**, with what is missing; once the employee card is filled in they are marked **"details completed, ready to send"**, and the send checks again, saves the values (FR-RND-8) and sends, or sets "No email". And signed assignments where **"the employee corrected her email: old → new"** (FR-SGN-9), so the manager fixes it in Har Gal; worked out from the data, it disappears once the stored email matches the one she gave. And open Pending / Sent / Opened assignments **locked** after 5 wrong ID numbers (with the unlocks left), for handling at the office (FR-SGN-2); they are never sent from here. Fixing an email here saves it on the employee card and sends nothing; the screen reminds the manager to fix it in Har Gal too (FR-EMP-7). |
| FR-MAN-2 | A manager can print an employee's personalized PDF (from the saved values, FR-RND-8; drawn like the employee's view, today as the document date). Open assignments with saved values can be printed (Pending, Sent, Opened, No email, Invalid email; also when locked or the link expired). Missing data has nothing saved yet: complete the card and send first (it then becomes printable even without an email). Signed and cancelled assignments are not printed. Each print is logged as a document view. |
| FR-MAN-3 | A manager can upload a scan of a paper-signed document; the status becomes "Signed manually". No answers are stored for it: the paper itself is the record. The same assignments as print (FR-MAN-2). PDF only, content checked, at most 20 MB and 100 pages. Stored like a signed file (department at send time), never over another file, with its SHA-256. All links then show "already signed" and reminders stop. It never waits for approval, and **no signed copy is emailed**: she signed the paper at the office, and there is no confirmed address (FR-SGN-6 sends to the address of the link used). |
| FR-MAN-4 | **Office signing station:** a manager opens signing for an employee on an office computer. The employee still enters their ID number, fills in the form (FR-SGN-4) and signs themselves. It runs on a **separate office computer where no staff user is signed in** (decided in 5.7): every kiosk route refuses a request that carries a valid staff session (409 `KIOSK_STAFF_SIGNED_IN`), so the employee is never next to an open staff app. Opening it shows the manager a **short code** in a dialog (8 characters without look-alikes, with "valid until HH:MM"; one use, 10 minutes on the database clock, only its SHA-256 stored, never emailed or logged; a new one ends the earlier one; closing the dialog doesn't end it). It is typed at `/kiosk` on the office computer, where it is traded once for the long kiosk code (256 bits, only its SHA-256 stored), kept in that page's memory only; the long code works 10 minutes until her correct ID number, then the usual 15-minute signing session. Codes go only in request bodies, so no address holds personal data. Wrong short codes are limited per IP and from all IPs together (correct ones only by a loose per-IP cap: the office computers may share one public IP) and logged without the code. Open for the same assignments as print (FR-MAN-2), also after the link expired. A locked one that can still be unlocked is unlocked first (FR-SGN-2); one locked for good (no unlocks left, or the link expired) opens with **the kiosk session's own 5 ID attempts**: 5 wrong end only that kiosk session, and her links stay locked (the lock and the unlock count never change). Otherwise wrong ID numbers count toward the same 5-attempt lock as her links. Signed: "Signed" with method kiosk and the manager in `handled_by`; every link shows "already signed" and reminders stop; the answers may wait for approval like a digital signature. Signed copy: to the email she gives in the email section if she chooses "email" (she is there in person, her ID number checked, and typed or confirmed it herself), none for "at the office"; it never changes her stored email. |

### Administration

| ID | Requirement |
| --- | --- |
| FR-ADM-1 | A manager can add, disable and change the role of staff users. |
| FR-ADM-2 | A manager can change the default settings: reminder interval, maximum reminders, link expiry, sender name, the no-reminder dates (up to 100 dates on which the daily reminders send nothing, FR-REM-1; none by default), and the HR contact (name, phone, email; phone or email at least) shown on the signing pages and in every email footer (built-in default: the deployment's values). A manager uploads the **employer signature and stamp image** (עץ הדעת) once: PNG only, content checked, size limit, private storage. Replacing it stores a new file (never an overwrite); assignments already sent keep the image saved with them (FR-RND-8). Uploads and views are logged; officers can't see it. |
| FR-ADM-3 | Every important action is written to an activity log that can't be edited. |

## 7. Screens

The MVP has 12 management screens and 5 employee screens, all in Hebrew, right to left.

Wherever a department is shown or picked (lists, filters, cards, wizard, exports), it appears as **"code - name"**, for example "15 - ממלאות מקום ירושלים", the way HR knows it from Har Gal. Department lists are sorted by code.

### Management area (managers and officers)

| # | Screen | Main contents | Who |
| --- | --- | --- | --- |
| A1 | Login (כניסה) | Email and password | All staff |
| A2 | Dashboard (לוח בקרה) | Totals across active rounds, including "waiting for approval"; rounds that need attention | All staff |
| A3 | Send rounds (סבבי שליחה) | Rounds with document, date, recipients, % signed, state | All staff |
| A4 | Round details (פרטי סבב) | One row per employee: status (with the "waiting for approval" flag, and "returned for correction → sent again in round X" with a link), department ("15 - name"), last update, reminders, email-section answer, answers panel, link to signed PDF; counts with "returned for correction" apart from "cancelled"; a correction round links back to the original; filters (including department and approval), search, export, ZIP; manager actions (remind, resend, cancel, unlock, manual signature, office signing, approve, return for correction) . Columns (fit 1280 px): employee (name, number), department, status, dates (sent / opened / signed), last update and reminders, email answer, and document / answers / actions on the left edge (stays in view when the table scrolls). Row actions by status in one menu (unlock shows "N of 2 left", at 0 "handle at the office": a link to that row in manual handling, A10, which cancels nothing); round actions next to "refresh": remind everyone (with the skip counts), cancel the round (typed confirmation); a draft: send or cancel. The answers panel opens on click only | All staff; actions for managers |
| A5 | New round wizard (אשף סבב חדש) | Name and mode, document, recipients (departments as "15 - name"), summary, settings, preview, send | Manager |
| A6 | Employees (עובדים) | List with department ("15 - name"), search and filters, email status mark, import and add buttons | All staff; edits for managers |
| A7 | Employee card (כרטיס עובד) | Details including department ("15 - name"), landline and mobile, address and city, birth date (DD/MM/YYYY) and age, role, employment status, job %, work days and hours, pension funds and study fund; history across rounds, signed documents, "Send document" shortcut. The ID number is shown to managers only | All staff; edits for managers |
| A8 | Excel import (ייבוא מאקסל) | Upload the Har Gal export, check report, preview (including new and renamed departments as "15 - name"), confirm | Manager |
| A9 | Templates (תבניות) | Templates with departments ("15 - name"), version, field positions (type, key, Hebrew label, who fills it in, required or optional, "shown only when", limits, needs approval, pension source), employer-signature setting, the "ready" reasons, preview with missing values. The position editor shows one card per box and the preview PDF with every unsaved position outlined on it; the "ready" reasons update while the manager types | Manager |
| A10 | Manual handling (טיפול ידני) | Employees with no or bad email or missing data across rounds ("email added" / "details completed, ready to send"), locked rows (with the unlocks left; round details links a row with none left here), and employees who corrected their email; filters (round, department, reason) in the address, search in a POST body; send one or the selected ready rows, print, upload scan, office signing station (the short code in a dialog, typed at `/kiosk` on the office computer, FR-MAN-4), fix email (with the Har Gal reminder). Tab **"Waiting for approval"** (`/manual/approvals`): signed documents waiting for approval (filter by round), what needs approval as chips, the answers panel of A4 with Approve / Return for correction (with a note) and "Send again" | Manager; the approval tab is read-only for officers (no tabs, no buttons) |
| A11 | Settings (הגדרות) | Reminder interval, maximum reminders, link expiry, sender name, no-reminder dates, employer signature and stamp image | Manager |
| A12 | Staff users (משתמשי מערכת) | Add, disable, change role | Manager |

### Employee area (signing, computer and mouse first)

| # | Screen | Main contents |
| --- | --- | --- |
| B1 | ID check (אימות זהות) | Short welcome, ID number field, Continue |
| B2 | Document (צפייה במסמך) | The personalized PDF; the Sign button becomes active after scrolling to the end |
| B3 | Form and signature (טופס וחתימה) | For a correction: "תיקון נדרש: <note>" at the top. A short form above the pad: the boxes she fills in and the email section (email box pre-filled, or "no email, at the office"; exactly one), in the template's order, Hebrew labels and errors, small pads for drawing boxes; then the large drawing pad, Clear and Confirm buttons, reading statement checkbox |
| B4 | Done (אישור) | "The document was signed. A copy was sent to your email." |
| B5 | Messages | Link expired, already signed, locked, cancelled; each with HR contact details. An unknown link: "the link is not valid" (open the latest email). At the office signing station: locked or an ended code → "ask the manager for a new code" |

### Emails (Hebrew, right to left)

1. **Invitation:** document name, personal link and the link's expiry date (DD/MM/YYYY). For a correction round (FR-TRK-6), one extra line: a corrected document is waiting. Never the manager's note.
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
2. The positions of the system values, the email section, the boxes the employee fills in, the employee's signatures and the employer's signature are set (by the developer in the MVP), with the employer-signature setting and the pension source.
3. The manager sets each box (FR-TPL-10): Hebrew label, who fills it in, required or optional, "shown only when", limits (length, list options, dates) and "needs approval". The template shows what is still missing before it is ready (FR-TPL-8).
4. Preview with a sample employee to check the Hebrew text and the missing values; save.

### Flow 3: Create a send round (manager)

1. Send rounds → New round; enter a name.
2. Choose the mode: one template, or by department (each employee gets their department's PDF).
3. Choose recipients: all, departments, hand-picked, or one employee. Options can be combined.
4. Review the summary: X will get email, Y have no email, Z already signed (skip or send again), W missing data (who is missing what).
5. Check the round settings: reminders, interval, maximum, link expiry (prefilled from the settings; all four are saved with the round). The screen shows "if sent today: valid until DD/MM/YYYY", by the send's own rule.
6. Preview the document (for the made-up sample employee, or one chosen employee; the ID number appears only inside the PDF) with what the preview found, and the invitation email (sample name, placeholder link, no address).
7. Send, after a confirmation with the counts. The draft round is created once, then sent; each assignment's values are saved, and emails go out in the background; the round screen shows progress. If the send fails the draft stays: send again or cancel it. A template replaced or archived since the draft asks to confirm sending the round's own version. When it is unclear whether the draft was created (no answer), the wizard never creates again blindly: it shows the summary afresh and points to the drafts list.

### Flow 4: Signing (employee)

1. The employee clicks the link in the email (invitation or any reminder).
2. They enter their ID number.
   - Correct: status becomes "Opened"; a 15-minute signing session starts.
   - Wrong: an error; after 5 wrong attempts the assignment locks and the attempt is logged.
3. They read their personalized document and scroll to the end.
4. They fill in the short form (the boxes the template asks for, and the email section: keep or correct the email, or "no email, at the office"), draw a signature, tick the reading statement and confirm. A required box left empty shows a Hebrew error and blocks the confirm.
5. The system checks the answers again, saves them (drawings as images in private storage), builds the signed PDF (answers and signature in every matching position), locks it, saves it, records its hash, sets the status to "Signed", stops reminders and emails the copy.
6. The Done screen. Every link for this assignment now shows "Already signed".

### Flow 5: Reminders (system, daily)

1. The job runs every day at 09:00, Sunday to Thursday, except on the no-reminder dates. It first settles emails whose sending job was lost, so a round still "sending" can finish.
2. For each active round, it finds recipients in Sent or Opened status whose last email is at least the interval old.
3. It sends each one a reminder with its own link and counts it.
4. Bounces from the email provider set the status to "Invalid email".

### Flow 6: Tracking (manager or officer)

1. From the dashboard, open a round.
2. Filter, for example "department X, not signed".
3. Officer: view, open signed PDFs, export to Excel, download ZIP.
4. Manager can also remind now, fix an email and resend, unlock, cancel.
5. Documents waiting for approval: open the answers; Approve, or Return for correction with a note, then "Send again" (a correction round for that employee, FR-TRK-6). Officers see the list only.

### Flow 7: Employees without email (manager)

1. Open Manual handling, or filter the round by "No email".
2. Choose one way:
   - **Missing data:** fill in the employee card, then send with one click ("details completed, ready to send").
   - **Office signing station:** open it for the employee in A10 and read the short code off the dialog; on the separate office computer (no staff user signed in) type it at `/kiosk`; the employee enters their ID, fills in the form and signs.
   - **Paper:** print the personalized PDF, have it signed, upload the scan; status becomes "Signed manually".
   - **Fix the email:** the system sends to the employee automatically.

## 9. Permissions

Permissions are checked on the server for every request, not only hidden in the interface.

The employee's ID number protects every signing link (it is also left out of the Excel export), so only managers see it on the employee card; the API leaves it out of an officer's answer.

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
| See documents waiting for approval and the employee's answers | Yes | Yes | No |
| Approve, or return for correction and send again | Yes | No | No |
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
- **One drawing, many positions.** The employee draws one signature; the same image is placed at every employee-signature position whose condition matches (FR-SGN-10). The employer signature is one uploaded image, placed per the template's setting (FR-TPL-7). Drawing boxes (FR-TPL-9) are separate images, one per box, each fitted into its own positions.
- **Boxes are data, not code.** Box types, settings and conditions are stored per template (`template_fields`), and one shared rule set builds the checks for both the signing form and the server. Answers are keyed by the box's `key`, open text, so later documents and custom employee details (section 4) add boxes without schema changes to `assignment_responses`.
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
| GET | `/api/employees?dept=&emailStatus=&active=&page=&pageSize=` | List with filters and paging; no search text (`q` → 400) | M, O |
| POST | `/api/employees/search` | The same filters and paging, plus `q` in the body (name, part of the employee number, or the full ID number). Search text never goes in a URL: it may be an ID number | M, O |
| GET | `/api/employees/:id` | Employee card (the ID number only in the manager's answer) | M, O |
| GET | `/api/employees/:id/assignments?page=` | History across rounds, newest first: round, document, department at the time, status, dates, whether a signed file exists | M, O |
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
| PATCH | `/api/templates/:id` | Update name, departments, field positions or box settings (FR-TPL-10); a locked template gets a new version for a new name, positions or settings | M |
| GET | `/api/templates/:id/preview?employeeId=` | PDF filled with the chosen employee, or a made-up sample employee when `employeeId` is left out (FR-TPL-3); not cached | M |
| GET | `/api/templates/:id/preview/check?employeeId=` | What the same preview found: the missing values and the boxes left for the employee (Hebrew field names only, never the values), plus warnings (template not ready, archived or old, employer signature image missing, employee inactive, text too long for its box, characters the font lacks) | M |
| GET | `/api/templates/:id/invitation-preview?linkExpiryDays=` | The invitation email for this document as if the round were sent now (Flow 3 step 6): sender name, subject, HTML and text, rendered by the real invitation template with a made-up employee name and a placeholder link (`/sign/example-link`, not a token); expiry = now + `linkExpiryDays` × 24 h (default the setting). No recipient address; nothing is sent, stored, queued or logged | M |
| POST | `/api/templates/:id/archive` | Archive a template | M |

### Send rounds

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | `/api/rounds?status=&page=` | List rounds, newest first, with % signed; a draft shows "טיוטה" and how long ago it was created | M, O |
| POST | `/api/rounds/recipients-preview` | Counts for a recipient choice (mode, templates, recipients, skip or send again to those who signed): will send, no email, already signed, already open in another round, missing data (who is missing what), inactive; each department with its template, "no template" or the templates to choose from; text that won't fit (box names only); what still blocks creating the round. Field names only, nothing created | M |
| POST | `/api/rounds` | Create a draft round (name, mode, templates, recipients, settings): the round, its templates and one assignment per recipient; nothing is sent; 409 while the preview has blockers | M |
| POST | `/api/rounds/:id/send` | Send a draft round: body `{ confirmOutdatedTemplateIds? }`. Saves the values, checks every status again, sets the link expiry and queues one invitation per employee with an email; 202 with the counts. 409 if not a draft, if a template isn't ready, or if a template was archived or has a newer version and its id isn't in `confirmOutdatedTemplateIds` (the round still sends its own version) | M |
| GET | `/api/rounds/:id` | Round details: settings, dates, templates, send progress, counts by status and by department (at send time), and the original round of a correction round | M, O |
| GET | `/api/rounds/:id/assignments?status=&dept=&approval=&returned=&page=` | Per-employee table: filters (display statuses, department at send time, waiting for approval, returned) and paging; no search text. Each row has `unlocksLeft` (unlocks still allowed, out of 2; the unlock rule's own count), so the screen can offer unlock or "handle at the office" (a link to manual handling) | M, O |
| POST | `/api/rounds/:id/assignments/search` | The same table searched by name, employee number or full ID number: body `{ q, status?, dept?, approval?, returned?, page?, pageSize? }`. Search text is never put in a URL (an ID number would reach server and proxy logs) | M, O |
| GET | `/api/rounds/:id/export` | Status export to Excel (the table filters, never search text); logged | M, O |
| GET | `/api/rounds/:id/download` | ZIP of signed files in department folders, streamed (`?dept=`); 409 when there is none, 429 while the user's previous ZIP runs; logged | M, O |
| POST | `/api/rounds/:id/remind` | Remind everyone in Sent or Opened status, now (FR-REM-3); 202 with how many were queued and how many were skipped (locked, no valid email, an email on its way, emailed in the last 24 hours). 409 for a draft, a closed or cancelled round, or an expired link | M |
| POST | `/api/rounds/:id/cancel` | Cancel the round, also a draft (FR-RND-7): every open assignment is cancelled, signed ones stay; 409 if already closed or cancelled | M |

### Assignments (one employee in one round)

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | `/api/assignments/:id/document` | 302 to a link to the signed PDF valid 5 minutes (also a returned one); 409 without a signed file, 404 when storage lost it; each view logged | M, O |
| GET | `/api/assignments/:id/print` | Personalized PDF for paper signing (FR-MAN-2), inline with a Hebrew file name, never cached; logged. 409 for missing data, signed or cancelled | M |
| POST | `/api/assignments/:id/remind` | Remind this employee now (Sent or Opened; not locked; not within 1 hour of the last email); 202 | M |
| POST | `/api/assignments/:id/resend` | A new invitation after a failed send, or after a wrong email was fixed (the address must differ from the one that failed); 202. Sent or Opened rows get a reminder instead; no email or missing data rows are sent from manual handling | M |
| POST | `/api/assignments/:id/unlock` | Unlock after 5 wrong ID attempts (at most twice per assignment; not after expiry); returns the unlocks left | M |
| POST | `/api/assignments/:id/cancel` | Cancel for this employee (any open status, also in a draft); every link of hers shows "cancelled" | M |
| POST | `/api/assignments/:id/manual-sign` | Upload a scanned paper signature (multipart `file`, PDF, FR-MAN-3): status "Signed manually"; 201 with the file's SHA-256. Same statuses as print | M |
| POST | `/api/assignments/:id/kiosk` | Open the office signing station (FR-MAN-4): 201 `{ assignmentId, shortCode, expiresAt, kioskPath }`; the short code is shown in the dialog and typed at `kioskPath` on the office computer. Same statuses as print, also expired; locked with an unlock left → 409 `ASSIGNMENT_LOCKED` (unlock first); locked for good → the kiosk session's own 5 attempts | M |
| GET | `/api/assignments/:id/responses` | What the employee filled in, with each box's label, in template order (drawings as storage links valid 5 minutes); the email section (choice, the address she gave, whether it differs from the stored one, never the stored one); the return note when returned. Logged as a view (counts only) | M, O |
| POST | `/api/assignments/:id/approve` | Approve a signed document waiting for approval; the signed PDF never changes; logged. 409 if not waiting | M |
| POST | `/api/assignments/:id/return` | Body `{ note }` (required, up to 500 characters). Return for correction: cancels the assignment, the signed PDF stays stored; logged without the note. 409 if not waiting | M |
| POST | `/api/assignments/:id/send-again` | After a return: create and send the linked one-employee correction round (FR-TRK-6) in one step; 409 if one already exists (with its id), if the employee is inactive, or if the newest version of the template is archived or not ready. Returns the new round | M |

### Manual handling

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | `/api/manual-handling?roundId=&dept=&kind=&page=` | The FR-MAN-1 list across sent rounds: no email, invalid email, missing data (names of what is missing), locked Pending / Sent / Opened rows (kind `locked`, for the office) and signed documents whose employee gave another email; each row says whether it is ready to send ("email added", "email fixed", "details completed"), the employee's email status and the unlocks left (out of 2). No search text | M |
| POST | `/api/manual-handling/search` | The same list searched by name, employee number or full ID number: body `{ q, roundId?, dept?, kind?, page?, pageSize? }` | M |
| POST | `/api/manual-handling/send` | Body `{ assignmentIds }` (1–100): send the ready rows, a normal invitation with a new link; missing data is checked again and its values saved (no valid email → No email). All rows or none: 409 lists each refused row | M |

### Approvals

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | `/api/approvals?roundId=&page=` | Signed documents waiting for approval, across rounds, oldest signature first; each row names the boxes that need approval (labels only, never the answers) | M, O |

### Dashboard and settings

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | `/api/dashboard/summary` | Totals across sending and active rounds, each such round with the rows needing attention, and the open drafts | M, O |
| GET | `/api/settings` | Read settings | M |
| PATCH | `/api/settings` | Update settings | M |
| POST | `/api/settings/employer-signature` | Upload the employer signature and stamp image (PNG); logged | M |
| GET | `/api/settings/employer-signature` | Short-lived link to the current image; logged | M |

### Employee signing (public)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/sign/:token` | Link state only: `{ state: valid \| signed \| cancelled \| expired \| locked, hrContact }`. No personal details. Unknown or malformed token → 404. |
| POST | `/api/sign/:token/verify` | Body `{ idNumber }`. Correct: opens a 15-minute signing session (cookie `sign_sid`) and sets "Opened". Wrong: counts the attempt (401 with the attempts left); locks at 5 (423). A typo in the format or check digit → 400, not counted. |
| GET | `/api/sign/:token/document` | The personalized PDF; needs the signing session |
| GET | `/api/sign/:token/form` | The form for B3: the boxes she fills in (key, type, label, required, condition, limits, order), the pre-filled email, and the correction note if this is a correction round. Needs the signing session; no box values from the employee card except the email |
| POST | `/api/sign/:token/fit` | Body `{ answers: { [key]: string } }` → `{ tooLong: [key] }`: the typed texts that would not fit their place in the document (FR-TPL-9), measured like the signed PDF. Needs the signing session |
| POST | `/api/sign/:token/submit` | Body `{ signatureImage, acknowledged: true, emailChoice: "email" \| "office", email?, answers: { [key]: string \| boolean }, drawings: { [key]: "<PNG, base64>" } }` (`email` required for `"email"`, FR-SGN-9; `answers` and `drawings` checked with the template's rules, FR-TPL-10). Saves the answers, builds and saves the signed PDF, emails the copy, closes all links of the assignment. |

A link that isn't valid is refused on every route after the state: signed / cancelled / expired → 409 (`SIGN_ALREADY_SIGNED`, `SIGN_CANCELLED`, `SIGN_LINK_EXPIRED`), locked → 423 `SIGN_LOCKED`; no session, an expired one or another link's → 401 `SIGN_SESSION_EXPIRED`; over a per-IP limit → 429 `SIGN_TOO_MANY_REQUESTS` with `Retry-After`. These routes send `Referrer-Policy: no-referrer` and may not be shown in another site's frame.

### Office signing station (public, FR-MAN-4)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/kiosk/code` | Body `{ code }`: the short code typed on the office computer (case, spaces and hyphens ignored). 200 `{ code }`: the long kiosk code for the routes below, valid 10 minutes; one use. Wrong, used, replaced or old → 404 `KIOSK_CODE_NOT_FOUND`, logged without the code. 429 after 10 wrong per IP or 100 wrong from all IPs in 15 minutes (correct ones: at most 120 per IP) |
| POST | `/api/kiosk/state` | Body `{ code }`: `{ state, hrContact }` only. An unknown, used, replaced or old code → 404 `KIOSK_CODE_NOT_FOUND` |
| POST | `/api/kiosk/verify` | Body `{ code, idNumber }`: the same ID check as a link (counted in the same 5 attempts, or in the kiosk session's own 5 on a row locked for good); correct → uses the code, opens a 15-minute session (cookie `kiosk_sid`, path `/api/kiosk`) |
| GET | `/api/kiosk/document` | The personalized PDF; needs the kiosk session |
| GET | `/api/kiosk/form` | The same form as `/api/sign/:token/form` |
| POST | `/api/kiosk/fit` | The same as `/api/sign/:token/fit` |
| POST | `/api/kiosk/submit` | The same body as `/api/sign/:token/submit`. Signs (method kiosk), ends the kiosk session and clears the cookie |

Nothing here reads who the staff user is, and every route refuses a request with a valid staff session cookie (409 `KIOSK_STAFF_SIGNED_IN`, checked without extending that session): the office computer has no staff user signed in. Every answer is `no-store` (the PDF too); after submit every call is 401, so going "back" can fetch nothing. Same refusals, headers and per-IP limits as the signing routes.

### System

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | 200 `{ status: "ok", database: "ok" }`, or 503 with `database: "down"`. No versions or other details. Public. |

### Webhooks

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/webhooks/email` | Delivery and bounce notices from the email provider. Public (no staff session); the provider's signature is checked on the raw body before anything else is read (constant-time compare, notices older than 5 minutes refused): no, wrong or old signature → 401 with no details. A per-IP limit per 15 minutes (429). An unknown message id → 200 and ignored (logged), so the provider doesn't retry it; the same notice twice changes nothing. Rules in FR-REM-4. |

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
| hours\_base\_code | smallint NULL, ≥ 0 | שעות עבודה: the **full-time base code**, not hours. 1 = 42 hours a week, 3 = 30, 4 = 40; 0 and other codes are unknown, kept and shown as the code. Not used by any template until HR confirms (section 14) |
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
| is\_locked | boolean | True once a round uses it (set when the round is created) |
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
| field\_type | enum | One value per thing drawn (FR-TPL-2). System values: `full_name`, `id_number`, `employee_number`, `address`, `landline`, `mobile`, `age`, `job_title`, `employment_status`, `job_percent`, `work_days`, `study_fund`, `date` (no `work_hours` until the hours-base codes are confirmed, section 14); pension: `pension_has_fund`, `pension_no_fund` (checkbox ticks), `pension_fund_name`; email section: `email_input`, `no_email_checkbox`; boxes the employee fills in (FR-TPL-9): `text` (short), `long_text`, `select`, `checkbox`, `date_input` (a date she picks; `date` stays the document date), `drawing`; signatures: `signature` (employee), `employer_signature`. New values may be added later (for example `custom_detail`); code must not assume this list is closed |
| key | varchar(50) | The box's identity inside the template, ASCII (`[a-z][a-z0-9_]*`). System values use their own name (`address`); other boxes get a key when created (for example `box_3`). Unique per box, not per position: positions with the same key are one box (one answer, drawn at each) and must have the same type and settings. Kept when a new version is created, so answers line up across versions |
| fill\_mode | enum `system` / `employee` / `system_then_employee` | Who fills it in (FR-TPL-10). Boxes the employee fills in are always `employee`; `full_name`, `id_number`, `employee_number`, `age`, `date` are always `system`. Not used by signatures |
| needs\_approval | boolean | Default false. An answer the employee gave in this box puts the signed document in "waiting for approval" (FR-TRK-6) |
| page | int | From 1 |
| x, y, width, height | numeric(7,2) | PDF points, from the bottom-left corner of the page's visible area (CropBox). `y` below 16 (the signed PDF's footer line) is saved but makes the template "not ready" (FR-TPL-8) |
| font\_size | int NULL |  |
| label | varchar(255) NULL | The Hebrew label shown on the signing form; required for every box the employee may fill in |
| is\_required | boolean | `system`: true = an empty value means "Missing data"; false = may stay empty, drawn blank. `employee` / `system_then_employee`: true = she can't submit it empty (FR-TPL-6) |
| show\_when | jsonb NULL | NULL = always shown. Otherwise one condition `{ "key": "<box key or email_choice>", "equals": "<value>" }`, e.g. the signature line under "no email" = `{ "key": "email_choice", "equals": "office" }`, or `{ "key": "box_2", "equals": "true" }` for a ticked checkbox. Allowed on every position (FR-TPL-10) |
| options | jsonb NULL | Box settings: the pension source `{ "pensionSource": "a_then_b" \| "b_only" }` (FR-TPL-5); text `{ "maxLength": 100 }`; list `{ "choices": ["…", "…"] }`; date `{ "minDate": "2026-01-01" \| "signing_day", "maxDate": … }` (FR-TPL-10) |
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
| link\_expiry\_days | smallint | 1–365, from the settings or the manager's value; counted from the send |
| link\_expires\_at | timestamptz NULL | NULL while the round is a draft; set at send = send time + `link_expiry_days` |
| correction\_of\_assignment\_id | uuid FK → assignments NULL, UNIQUE | Set on a correction round: the returned assignment it replaces (FR-TRK-6). One correction round per returned assignment |
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
| signed\_file\_key | text NULL | `rounds/<round_id>/<department_code>/<employee_number>.pdf`; department = `department_id` above (at send time). Files are never overwritten: if an earlier, unfinished signing attempt with different answers left a file there, the signature is stored as `<employee_number>-2.pdf` (then `-3` …) and the earlier file stays unused (logged). Only this key is the signed document. Storage keys are ASCII only (ids and numbers); the Hebrew name appears only in the download file name and in the ZIP |
| signed\_file\_sha256 | char(64) NULL | Proves the file hasn't changed |
| signer\_ip | inet NULL |  |
| signer\_user\_agent | text NULL |  |
| handled\_by | uuid FK → users NULL | Manual scan or kiosk |
| needs\_approval | boolean | Default false. Set at signing, in the same transaction, when an answer is in a box with `needs_approval` (FR-TRK-6) |
| approved\_at | timestamptz NULL | Set by Approve |
| approved\_by | uuid FK → users NULL |  |
| returned\_at | timestamptz NULL | Set by Return for correction (status becomes `cancelled`) |
| returned\_by | uuid FK → users NULL |  |
| return\_note | varchar(500) NULL | The manager's note, shown to the employee after the ID check in the correction round; never in emails, URLs or the audit log |
| cancelled\_at | timestamptz NULL |  |
|  | UNIQUE (round\_id, employee\_id) | Once per round |

**`email_messages`**: every email, with its link token

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| assignment\_id | uuid FK → assignments |  |
| type | enum `invite` / `reminder` / `signed_copy` |  |
| to\_email | varchar(255) | Address actually used |
| token\_hash | char(64) UNIQUE NULL | SHA-256 of this email's link token; NULL for the signed copy. An invite or reminder gets it just before it is sent (NULL while `queued`, and again if it clearly never left, then `failed`); one that went out always has it |
| provider\_message\_id | varchar(255) NULL | Matches bounce notices; none on an email the provider never confirmed |
| status | enum `queued` / `sent` / `delivered` / `bounced` / `failed` | `bounced`: set by a hard bounce notice (FR-REM-4), only from `sent` / `delivered`; still counts as sent |
| error | text NULL |  |
| sent\_at | timestamptz NULL |  |

**`assignment_responses`**: what the employee chose, wrote or drew, one row per box

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| assignment\_id | uuid FK → assignments |  |
| key | varchar(50) | `email_choice` (`email` / `office`), `email` (the address given), or the box's `template_fields.key`. Open text, never a fixed list |
| template\_field\_id | uuid FK → template\_fields NULL | The box's first position; NULL for the email section |
| value | text NULL | `true` / `false` for a checkbox, the chosen option, a date as `YYYY-MM-DD`, or the text. NULL for a drawing |
| file\_key | text NULL | Drawings only: `responses/<assignment_id>/<key>.png` in private storage, never overwritten (PNG only, size limit, not empty, NFR-SIG-3) |
|  | UNIQUE (assignment\_id, key) | One answer per key. A hidden or unanswered optional box has no row |

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
| key | varchar(100) PK | e.g. `reminder_interval_days`, `max_reminders` (null = no limit), `link_expiry_days`, `sender_name`, `reminder_skip_dates` (list of `YYYY-MM-DD`), `hr_contact` (`{ name, phone, email }`, FR-ADM-2), `employer_signature` (`{ fileKey, uploadedAt, width, height, sha256 }`, FR-ADM-2) |
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

**`signing_sessions`**: employee signing sessions (FR-SGN-8)

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| token\_hash | char(64) UNIQUE | SHA-256 of the `sign_sid` cookie token; the token itself is never stored |
| assignment\_id | uuid FK → assignments |  |
| email\_message\_id | uuid FK → email\_messages NULL | The link the ID check was made on; the session opens only that link, and the signed copy goes to its `to_email` |
| kiosk\_session\_id | uuid FK → kiosk\_sessions NULL | Or the office kiosk session (FR-MAN-4), cookie `kiosk_sid`. Exactly one of the two (CHECK) |
| expires\_at | timestamptz | ID check + 15 minutes, fixed |
| ip | inet NULL |  |
| user\_agent | text NULL |  |
| created\_at | timestamptz |  |

**`kiosk_sessions`**: office signing station sessions (FR-MAN-4); kept, never deleted

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| assignment\_id | uuid FK → assignments | At most one not ended per assignment (partial unique index) |
| code\_hash | char(64) UNIQUE | SHA-256 of the one-time code; the code itself is never stored |
| opened\_by | uuid FK → users | The manager; becomes `handled_by` of a kiosk signature |
| expires\_at | timestamptz | Opened + 10 minutes for the short code; once it is typed, + 10 minutes for the long code, until used |
| used\_at | timestamptz NULL | The correct ID number used the code |
| short\_code\_hash | char(64) NULL | SHA-256 of the short code the manager reads off A10; unique among the codes still waiting (partial unique index) |
| short\_code\_used\_at | timestamptz NULL | Typed on the office computer: traded for the long code, `code_hash` set, `expires_at` = then + 10 minutes |
| own\_attempts | boolean | Opened on a row locked for good: the session counts its own wrong ID numbers; the row's lock stays |
| failed\_attempts | int | 0–5 (CHECK); only with `own_attempts` |
| ended\_at | timestamptz NULL |  |
| end\_reason | enum `replaced` / `signed` / `locked` NULL | Set with `ended_at` (CHECK) |
| created\_at | timestamptz |  |

**`signing_rate_hits`**: per-IP counters of the public signing routes (NFR-SEC-3)

| Field | Type | Notes |
| --- | --- | --- |
| scope | varchar(20) | `all`, `state`, `verify`, `verify_wrong`, `document`, `form`, `fit`, `submit`, `kiosk_code`, `kiosk_code_wrong_ip`, `kiosk_code_wrong` (the last counted under no IP: all IPs together) |
| ip | inet |  |
| window\_start | timestamptz | Fixed 15-minute windows |
| hits | int |  |
|  | PK (scope, ip, window\_start) |  |

Rows of `sessions`, `login_attempts`, `signing_sessions` and `signing_rate_hits` are short-lived and deleted (logout, expiry, successful login, signing, daily cleanup; rate counters after 1 day); nothing references them except `signing_sessions` → assignments / email messages / kiosk sessions. `email_messages` has at most one `signed_copy` row per assignment (a partial unique index).

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
| assignments | assignment\_responses | 1:N | The employee's answers (email section and every box she fills in) |
| assignments | rounds | 1:0..1 | A returned assignment and its correction round (`rounds.correction_of_assignment_id`) |
| users | rounds, templates, import\_batches, audit\_log | 1:N | Who created or did what |
| users | sessions | 1:N | Staff login sessions |
| import\_batches | employees | 1:N | Last import that touched each employee |

### Indexes and rules

- `employees(employee_number)` and `employees(id_number)` UNIQUE; `departments(code)` UNIQUE.
- `assignments(round_id, status)` for round counts; `assignments(round_id, department_id)` for the round's department filter and counts; `assignments(employee_id)` for history.
- `assignments(status, last_reminder_at)` for the reminder job.
- `assignments(needs_approval, approved_at)` (partial: signed, needs approval, not approved) for the approval list and count; `rounds(correction_of_assignment_id)` UNIQUE.
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
- NFR-SEC-3: ID check uses a constant-time comparison, locks at 5 wrong attempts per assignment, has a rate limit per IP address, and logs every attempt. The 5-attempt lock per link is the real guard (link tokens can't be guessed). The per-IP limits cover every public signing route and only stop floods and link scans: the filters (NetFree, Etrog, Nativ, Rimon) send many employees through a few shared IP addresses, so the limits are high and set per environment. Per IP per 15 minutes, default (minimum): all signing routes 6,000 (600), link state 2,000 (200), ID checks 1,000 (100), wrong ID numbers 300 (30), document 1,000 (60), form 1,000 (100), text-fit check 4,000 (300), submit 300 (30); office short codes typed 120 (30), wrong ones 10 (3), and wrong ones from all IPs together 100 (20). The defaults let about 200 employees sign from one IP in one window. The first request over a limit in a window is logged, to tune them.
- NFR-SEC-4: The signing session is a short-lived cookie (15 minutes, `httpOnly`, `Secure`, `SameSite=Strict`, path `/api/sign`), cleared when the browser closes.
- NFR-SEC-5: After signing, every link of the assignment shows only "Already signed".

### Security: proof of signing

- NFR-SIG-1: The signed PDF is flattened so it can't be edited (everything drawn is page content: no form fields, annotations or scripts), with a footer line on every page: signing date, time (Asia/Jerusalem), reference number and "page X of Y". The reference is the first 12 hex digits of the assignment id (e.g. `3F9A-1C2B-7D40`): not secret, never the link token. Flattening is not a lock (any PDF can be changed with an editor); the stored SHA-256 proves the original. The same input always gives the same file.
- NFR-SIG-2: The system stores the file's SHA-256 hash, time, IP address and browser details, in `assignments` and `audit_log`.
- NFR-SIG-3: The signature image and every drawing-box image are checked before use: PNG only, maximum size, not empty. Drawings are stored as PNG files in private storage (never overwritten), not in the database row.
- NFR-SIG-4: The employee's answers (email section and every box she fills in) are part of the proof: checked on the server with the template's rules, drawn into the signed PDF before it is flattened and hashed, stored in `assignment_responses` in the same transaction as the signature, and recorded in the signing row of `audit_log` (the email choice and the keys of the boxes answered only, never the email address or the values).

### Security: staff and data

- NFR-SEC-6: Passwords are hashed with Argon2. Session cookies are `httpOnly`, `Secure`, `SameSite=Strict`, and end when the browser closes. Sessions are stored in the database (token hash only) and end after 30 minutes of inactivity or 12 hours after login. Login allows 5 failed attempts per email (20 per IP address) in 15 minutes, then answers "too many attempts". Wrong email, wrong password and disabled user get the same answer.
- NFR-SEC-7: Role checks run on the server for every endpoint.
- NFR-SEC-8: Storage is private. Signed files are reached only through links that expire within minutes, after a permission check. Each view is logged.
- NFR-SEC-9: Uploads accept only PDF and Excel, plus PNG for the employer signature image and for the employee's signature and drawing boxes, with size limits, and the file content is checked, not just its name.
- NFR-SEC-10: Excel exports neutralize cells starting with `=`, `+`, `-` or `@`.
- NFR-SEC-11: HTTPS everywhere; database and storage are encrypted at rest.

### Privacy

- NFR-PRV-1: All data is stored in an Israel cloud region.
- NFR-PRV-2: Daily backups with point-in-time restore.
- NFR-PRV-3: A retention policy for signed documents and logs, agreed with HR. It also covers the stored Excel imports (`imports/` in storage): they hold ID numbers and are kept even when a preview is never confirmed.
- NFR-PRV-4: Requirements under Israeli privacy law and its data security regulations are checked with a legal or privacy advisor before launch.
- NFR-PRV-5: If the email provider is outside Israel, the email content (name, link, signed copy) passes through it. This must be accepted, or an Israel-region provider chosen.
- NFR-PRV-6: The extra employee details (address, birth date, phones, role, job terms, funds) appear only on the employee card and in documents. They are never in lists, URLs, emails or the status export. The audit log records the birth date only as "changed", like the ID number.
- NFR-PRV-7: `assignments.field_values` is a copy of personal data (ID number, address, the age worked out from the birth date, phones and more). It is **never** written to logs, the audit log, lists, URLs or emails; it appears only in the document itself (view, print, signed PDF). The audit log records only that the values were saved, never the values. The same applies to the employee's answers (`assignment_responses`) and the return note: they appear only in the document, on the round screen and approval list (each view logged), and, for boxes the employee fills in that don't come from a system value, in the Excel export (FR-TRK-4). The return note is also shown to that employee after the ID check.

### Performance and reliability

| Area | Requirement |
| --- | --- |
| Bulk sending | A full round of 1,500 emails goes through the queue in batches, within the provider's rate limits: the send queues one job per email in one transaction (under 1 second for 1,500), and the worker sends at most `EMAIL_SEND_RATE_PER_SECOND` a second (default 10; AWS SES starts at 14, its sandbox allows 1): about 2.5 minutes for 1,500. An email whose result is unclear (a timeout while it was handed over) is never sent a second time; the next reminder carries a new link. SES production access is requested early. |
| Reminders | The daily job is safe to run twice and runs as one copy at a time. |
| PDF | The personalized PDF opens in under 2 seconds. The Hebrew font is loaded once. |
| Screens | Lists are paged; round counts come from indexed `GROUP BY` queries. |
| ZIP | Streamed from storage, never held whole in memory. |
| Availability | Single region, one small server; a short outage only delays signing, nothing is lost. |

### Hebrew and right to left

- **NFR**-HEB-1: The whole interface is Hebrew, right to left, including dates (DD/MM/YYYY) and error messages.
- NFR-HEB-2: Emails are Hebrew HTML with `dir="rtl"`.
- NFR-HEB-3: Text drawn on PDFs uses an embedded Hebrew font and right-to-left ordering. Testing includes names that mix Hebrew, numbers and hyphens, addresses with house numbers ("הרב קוק 12, בני ברק"), phones, an email address (left to right inside a right-to-left line), and long text the employee typed that wraps over several lines.
- NFR-HEB-4: File names in the ZIP use UTF-8 so Hebrew names open correctly in Windows.

### Usability for employees

- NFR-USE-1: Signing works in current Chrome, Edge and Firefox on Windows, and is tested at common filtered-internet setups.
- NFR-USE-2: The signature pad is at least 500 × 200 pixels on a computer screen, and smooths mouse lines.
- NFR-USE-3: The flow takes at most 4 screens, with large buttons and plain Hebrew: B1 ID check, B2 document, B3 form and signature (the boxes she fills in are on the same screen as the pad), B4 done.

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
- [x] Office signing station (FR-MAN-4): decided 2026-10-28 (5.7): a separate office computer with no staff user signed in, reached with a short typed code; the kiosk routes refuse a request with a valid staff session. A row locked for good opens there with the kiosk session's own 5 ID attempts; her links stay locked.
- [ ] After-school contract (צהרונית / סייעת צהרון): fields not decided yet. Nothing is built for it now; when it is, its pension field uses "ב only" (FR-TPL-5).
- [ ] Lawyer: confirm that one drawn signature placed by the system in several positions (main signature, employee declaration, the "no email" line) is acceptable.
- [ ] Hours base (שעות עבודה): it is a full-time base code, not hours (1 = 42, 3 = 30, 4 = 40 hours a week). HR to confirm what 0 and 2 mean and that the data is accurate. Until then it is stored and shown on the card only; no template uses it.
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
