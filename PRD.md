# PRD – Digital Document Signing & Tracking System

Oct 11, 2026 · @Chana

## 1. Executive summary

The system automates sending, signing and tracking employee documents for about 1,500 employees. It replaces a manual paper-and-email process. Managers and officers see each employee's status in real time.

**How it works in one paragraph:** a manager uploads the employee list from Excel and a ready PDF for each department. The manager chooses who gets a document: all employees, some departments, a hand-picked group, or one employee. Each employee gets an email with a personal link. They enter their ID number, read the document with their name and ID already filled in, and draw a signature with the mouse. The signed PDF is saved in a folder for their department, and a copy is emailed to them. Employees who don't sign get a reminder every 3 days until they sign.

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
| G2 | Personalize automatically | Each employee gets their department's PDF with their name and ID number filled in, with no manual editing. |
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

The MVP covers one document type: a department PDF that needs only the employee's name, ID number and a drawn signature. Everything else is designed for but built later.

### In the MVP

- Three roles: manager, officer, employee.
- Excel import with a fixed column format: preview, checks, new employees added, existing employees updated.
- One ready PDF per department, with set positions for name, ID number, date and signature.
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
| Employee notice and hearing notice (checkbox acknowledgment) | New form type | `checkbox` field type and `assignment_responses` table |
| Attendance reports from Har Gal (one ready PDF per employee) | Depends on the Har Gal export format | `assignments.source_file_key` |
| Visual drag-and-drop field editor | MVP sets field positions once per PDF | `template_fields` table |
| Column matching for different Excel layouts | MVP uses one fixed format | `import_batches` table |
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
| Assignment | One employee in one round: which PDF they get, their status, their signed file. |
| Template | A department's ready PDF plus the positions of the name, ID number, date and signature. |

### Assignment statuses

| Status (Hebrew) | Set when |
| --- | --- |
| Waiting to send (ממתין לשליחה) | The round was created; the email is in the queue. |
| Sent (נשלח) | The email provider accepted the invitation. |
| Opened (נפתח) | The employee entered a correct ID number. |
| Signed (נחתם) | The employee signed digitally. |
| Signed manually (נחתם ידנית) | A manager uploaded a scan of a paper signature. |
| Delivered (נמסר) | Delivery-only round (later): the email provider accepted the email. No  signature needed. |
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
| FR-EMP-1 | A manager can upload an `.xlsx` file in a fixed format (sample file downloadable): employee number, ID number, first name, last name, department, email, phone. |
| FR-EMP-2 | Before saving, the system shows a preview: new, updated, unchanged and rows with errors (with the reason per row). |
| FR-EMP-3 | Checks: valid Israeli ID number (check digit), no repeated employee numbers or ID numbers in the file, valid email format, known department. |
| FR-EMP-4 | On confirm, rows are matched by **employee number**: new numbers create employees, existing numbers update them. Employees missing from the file are left as they are, because payroll exports may be filtered by department. A manager can mark an employee inactive by hand. |
| FR-EMP-5 | New department names in the file can be created during import, after the manager confirms them. |
| FR-EMP-6 | Employees without a valid email are marked "No email" and appear in manual handling. |
| FR-EMP-7 | A manager can add or edit a single employee (for example, fix an email). |
| FR-EMP-8 | Every import is recorded: who, when, file, and counts. |

### Templates

| ID | Requirement |
| --- | --- |
| FR-TPL-1 | A manager can upload a PDF, name it and link it to one or more departments. |
| FR-TPL-2 | Each template stores positions (page, X, Y, size) for full name, ID number, date and signature. In the MVP the developer sets these once per PDF. |
| FR-TPL-3 | A manager can preview a template filled with a sample employee, to check the Hebrew text. |
| FR-TPL-4 | Once a template has been sent, it is locked. Changes create a new version; documents already sent don't change. |

### Send rounds

| ID | Requirement |
| --- | --- |
| FR-RND-1 | A manager creates a round with a name and a mode: one template, or by department. |
| FR-RND-2 | Recipients can be chosen and combined: all employees, chosen departments, hand-picked employees, or one employee (also from the employee card). |
| FR-RND-3 | In by-department mode, the system picks each department's template and warns if a department in the round has none. |
| FR-RND-4 | Before sending, the system shows counts: will get email, no email, already signed this template in another round (skip or send again). |
| FR-RND-5 | Per round: reminders on/off, reminder interval (default 3 days), link expiry (default 60 days). Reminders continue until the employee signs; an optional maximum can be set. |
| FR-RND-6 | Sending runs in the background in batches; the round screen shows progress. |
| FR-RND-7 | A manager can cancel a round or a single recipient. |

### Signing (employee)

| ID | Requirement |
| --- | --- |
| FR-SGN-1 | Each employee gets a unique link. The link shows no personal details until the ID number is entered. |
| FR-SGN-2 | The employee enters their ID number. 5 wrong attempts lock the assignment until a manager unlocks it. |
| FR-SGN-3 | The employee sees their personalized PDF (name and ID filled in) and must scroll to the end before signing. |
| FR-SGN-4 | The employee draws a signature with the mouse (touch also works), can clear and redraw, and confirms a reading statement. |
| FR-SGN-5 | On confirm, the system places the signature and date in the PDF, locks the file against edits, and adds a small line with the signing date, time and reference number. |
| FR-SGN-6 | The signed PDF is saved under round / department / employee, and a copy is emailed to the employee. |
| FR-SGN-7 | After signing, the link only shows "Already signed". Expired, cancelled and locked links show a clear Hebrew message with HR contact details. |
| FR-SGN-8 | The signing session ends after 15 minutes or when the browser closes. |

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
| FR-TRK-2 | The round screen lists every recipient with status, last update and reminders sent; filters by status and department; search by name, employee number or ID. |
| FR-TRK-3 | Managers and officers can open any signed document. Each view is logged. |
| FR-TRK-4 | Export a round's statuses to Excel, and download all signed files as a ZIP in department folders. |
| FR-TRK-5 | The employee card shows the employee's history across all rounds. |

### Manual handling

| ID | Requirement |
| --- | --- |
| FR-MAN-1 | A list of everyone with no email or a bounced email, across rounds. |
| FR-MAN-2 | A manager can print an employee's personalized PDF. |
| FR-MAN-3 | A manager can upload a scan of a paper-signed document; the status becomes "Signed manually". |
| FR-MAN-4 | **Office signing station:** a manager opens signing for an employee on an office computer. The employee still enters their ID number and signs themselves. |

### Administration

| ID | Requirement |
| --- | --- |
| FR-ADM-1 | A manager can add, disable and change the role of staff users. |
| FR-ADM-2 | A manager can change the default settings: reminder interval, maximum reminders, link expiry, sender name. |
| FR-ADM-3 | Every important action is written to an activity log that can't be edited. |

## 7. Screens

The MVP has 12 management screens and 5 employee screens, all in Hebrew, right to left.

### Management area (managers and officers)

| # | Screen | Main contents | Who |
| --- | --- | --- | --- |
| A1 | Login (כניסה) | Email and password | All staff |
| A2 | Dashboard (לוח בקרה) | Totals across active rounds; rounds that need attention | All staff |
| A3 | Send rounds (סבבי שליחה) | Rounds with document, date, recipients, % signed, state | All staff |
| A4 | Round details (פרטי סבב) | One row per employee: status, last update, reminders, link to signed PDF; filters, search, export, ZIP; manager actions (remind, resend, cancel, unlock, manual signature, office signing) | All staff; actions for managers |
| A5 | New round wizard (אשף סבב חדש) | Name and mode, document, recipients, summary, settings, preview, send | Manager |
| A6 | Employees (עובדים) | List with search and filters, email status mark, import and add buttons | All staff; edits for managers |
| A7 | Employee card (כרטיס עובד) | Details, history across rounds, signed documents, "Send document" shortcut | All staff; edits for managers |
| A8 | Excel import (ייבוא מאקסל) | Upload, check report, preview, confirm | Manager |
| A9 | Templates (תבניות) | Templates with departments, version, preview | Manager |
| A10 | Manual handling (טיפול ידני) | Employees with no or bad email across rounds; print, upload scan, fix email | Manager |
| A11 | Settings (הגדרות) | Reminder interval, maximum reminders, link expiry, sender name | Manager |
| A12 | Staff users (משתמשי מערכת) | Add, disable, change role | Manager |

### Employee area (signing, computer and mouse first)

| # | Screen | Main contents |
| --- | --- | --- |
| B1 | ID check (אימות זהות) | Short welcome, ID number field, Continue |
| B2 | Document (צפייה במסמך) | The personalized PDF; the Sign button becomes active after scrolling to the end |
| B3 | Signature (חתימה) | Large drawing pad, Clear and Confirm buttons, reading statement checkbox |
| B4 | Done (אישור) | "The document was signed. A copy was sent to your email." |
| B5 | Messages | Link expired, already signed, locked, cancelled; each with HR contact details |

### Emails (Hebrew, right to left)

1. **Invitation:** document name and personal link.
2. **Reminder:** the same request with a different subject; carries its own working link.
3. **Signed copy:** the signed PDF attached.

Emails stay short and light on images, to pass spam and internet filters.

## 8. User flows

Seven flows cover the MVP. The core is flow 3 (create a round) and flow 4 (signing).

### Flow 1: Import employees (manager)

1. Employees → Import from Excel; upload the `.xlsx` file in the fixed format.
2. The system checks every row (FR-EMP-3) and shows the preview: new, updated, unchanged, errors.
3. The manager confirms any new department names.
4. Confirm: new employee numbers are created, existing ones updated, missing ones left as they are.
5. Employees without a valid email are marked "No email".

### Flow 2: Set up a department template (manager + developer, once per PDF)

1. Templates → New; upload the department's ready PDF, name it, link departments.
2. The positions of name, ID number, date and signature are set (by the developer in the MVP).
3. Preview with a sample employee to check the Hebrew text; save.

### Flow 3: Create a send round (manager)

1. Send rounds → New round; enter a name.
2. Choose the mode: one template, or by department (each employee gets their department's PDF).
3. Choose recipients: all, departments, hand-picked, or one employee. Options can be combined.
4. Review the summary: X will get email, Y have no email, Z already signed (skip or send again).
5. Check the round settings: reminders, interval, maximum, link expiry.
6. Preview one employee's document and the email.
7. Send. Emails go out in the background; the round screen shows progress.

### Flow 4: Signing (employee)

1. The employee clicks the link in the email (invitation or any reminder).
2. They enter their ID number.
   - Correct: status becomes "Opened"; a 15-minute signing session starts.
   - Wrong: an error; after 5 wrong attempts the assignment locks and the attempt is logged.
3. They read their personalized document and scroll to the end.
4. They draw a signature, tick the reading statement and confirm.
5. The system builds the signed PDF, locks it, saves it, records its hash, sets the status to "Signed", stops reminders and emails the copy.
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
   - **Office signing station:** open signing for the employee on an office computer; the employee enters their ID and signs.
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

- **Text is drawn at stored positions, not into PDF form fields.** The department PDFs are used as they are. The system draws the name, ID number, date and signature at the positions in `template_fields`. This avoids a known weakness: PDF form fields handle Hebrew right-to-left text poorly.
- **The personalized PDF is built when the employee opens it**, not ahead of time. The final signed PDF is built once, at signing.
- **Every email carries its own link token.** Only a hash of each token is stored, so a reminder can't resend the original link. Instead each reminder gets a new token, and all tokens of an assignment work until it is signed or expires.
- **The Excel file has one fixed format** in the MVP, with a sample file to download.

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
| GET | `/api/employees/import/sample` | Download the sample Excel file | M |
| GET | `/api/departments` | List departments | M, O |

### Templates

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | `/api/templates` | List templates | M |
| POST | `/api/templates` | Upload a PDF with name and departments | M |
| PATCH | `/api/templates/:id` | Update name, departments or field positions; a locked template gets a new version | M |
| GET | `/api/templates/:id/preview?employeeId=` | PDF filled with a sample employee | M |
| POST | `/api/templates/:id/archive` | Archive a template | M |

### Send rounds

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | `/api/rounds` | List rounds with % signed | M, O |
| POST | `/api/rounds/recipients-preview` | Counts for a recipient choice: will send, no email, already signed | M |
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

### Employee signing (public)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/sign/:token` | Link state only: valid, expired, signed, locked, cancelled. No personal details. |
| POST | `/api/sign/:token/verify` | Body `{ idNumber }`. Correct: opens a 15-minute signing session and sets "Opened". Wrong: counts the attempt; locks at 5. |
| GET | `/api/sign/:token/document` | The personalized PDF; needs the signing session |
| POST | `/api/sign/:token/submit` | Body `{ signatureImage, acknowledged: true }`. Builds and saves the signed PDF, emails the copy, closes all links of the assignment. |

### Webhooks

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/webhooks/email` | Delivery and bounce notices from the email provider; the provider's signature is verified |

## 12. Data model

The database has 14 PostgreSQL tables built around `assignments`, which links one employee, one round and one PDF. Conventions: primary keys are `uuid`, dates are `timestamptz`, and every table has `created_at` and `updated_at` (not repeated below).

### Identity keys for employees

| Key | Used for | Why |
| --- | --- | --- |
| `id` (uuid) | Internal primary key and all foreign keys | Never changes and never leaves the system; length doesn't matter to the database |
| `employee_number` | **Matching rows on Excel import**, search, display, Har Gal file matching | Short, known to HR, and likely what Har Gal exports use |
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
| name | varchar(100) UNIQUE | Must match the Excel department names |
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
| phone | varchar(20) NULL | Reference only; nothing is sent to it |
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
| field\_type | enum `full_name` / `id_number` / `date` / `signature` / `checkbox` / `text` | Last two are for later |
| page | int | From 1 |
| x, y, width, height | numeric(7,2) | PDF points |
| font\_size | int NULL |  |
| label | varchar(255) NULL | Checkbox text (later) |
| is\_required | boolean |  |
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
| template\_id | uuid FK → templates NULL | NULL for an external report (later) |
| source\_file\_key | text NULL | Ready per-employee PDF, e.g. Har Gal (later) |
| status | enum `pending` / `sent` / `opened` / `signed` / `signed_manual` / `delivered` / `no_email` / `invalid_email` / `cancelled` | `delivered` is used only by delivery-only rounds (later) |
| failed\_attempts | smallint | Wrong ID attempts |
| locked\_at | timestamptz NULL | Set at 5 attempts; cleared on unlock |
| sent\_at, first\_opened\_at, last\_reminder\_at, signed\_at | timestamptz NULL |  |
| reminder\_count | smallint |  |
| sign\_method | enum `digital` / `manual` / `kiosk` NULL |  |
| signed\_file\_key | text NULL | `round/department/employee-number_name.pdf` |
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

**`assignment_responses`**: checkbox and text answers (later; table ready)

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid PK |  |
| assignment\_id | uuid FK → assignments |  |
| template\_field\_id | uuid FK → template\_fields |  |
| value | text | `true` / `false` or free text |

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
| key | varchar(100) PK | e.g. `reminder_interval_days`, `link_expiry_days`, `sender_name` |
| value | jsonb |  |
| updated\_by | uuid FK → users NULL |  |

### Relationships

| From | To | Type | Meaning |
| --- | --- | --- | --- |
| departments | employees | 1:N | Each employee belongs to one department |
| templates | departments | M:N via `template_departments` | A PDF can serve several departments |
| templates | template\_fields | 1:N | Field positions per PDF |
| templates | templates | 1:N (self) | Versions |
| rounds | round\_templates | 1:N | Which PDF each department gets in the round |
| rounds | employees | M:N via `assignments` | The core of the system |
| templates | assignments | 1:N | Each assignment uses one PDF |
| assignments | email\_messages | 1:N | Invite, reminders, copy; each with its own link |
| assignments | assignment\_responses | 1:N | Checkbox answers (later) |
| users | rounds, templates, import\_batches, audit\_log | 1:N | Who created or did what |
| import\_batches | employees | 1:N | Last import that touched each employee |

### Indexes and rules

- `employees(employee_number)` and `employees(id_number)` UNIQUE.
- `assignments(round_id, status)` for round counts; `assignments(employee_id)` for history.
- `assignments(status, last_reminder_at)` for the reminder job.
- `email_messages(token_hash)` UNIQUE for link lookup; `email_messages(provider_message_id)` for bounces.
- `audit_log(entity_type, entity_id)` and `audit_log(created_at)`.
- `ON DELETE RESTRICT` everywhere: employees and templates with signed documents are archived, never deleted.

## 13. Non-functional requirements

The data includes ID numbers and signed employment documents, so security and proof of signing come first; the load is small.

### Security: signing links

- NFR-SEC-1: Link tokens are random, 256 bits. Only their SHA-256 hash is stored.
- NFR-SEC-2: URLs and emails carry no ID numbers. The email shows only the employee's name, the document name and the link.
- NFR-SEC-3: ID check uses a constant-time comparison, locks at 5 wrong attempts per assignment, has a rate limit per IP address, and logs every attempt.
- NFR-SEC-4: The signing session is a short-lived cookie (15 minutes, `httpOnly`, `Secure`), cleared when the browser closes.
- NFR-SEC-5: After signing, every link of the assignment shows only "Already signed".

### Security: proof of signing

- NFR-SIG-1: The signed PDF is flattened so it can't be edited, with a footer line: date, time and reference number.
- NFR-SIG-2: The system stores the file's SHA-256 hash, time, IP address and browser details, in `assignments` and `audit_log`.
- NFR-SIG-3: The signature image is checked before use: PNG only, maximum size, not empty.

### Security: staff and data

- NFR-SEC-6: Passwords are hashed with Argon2. Session cookies are `httpOnly`, `Secure`, `SameSite=Strict`, with a timeout after inactivity.
- NFR-SEC-7: Role checks run on the server for every endpoint.
- NFR-SEC-8: Storage is private. Signed files are reached only through links that expire within minutes, after a permission check. Each view is logged.
- NFR-SEC-9: Uploads accept only PDF and Excel, with size limits, and the file content is checked, not just its name.
- NFR-SEC-10: Excel exports neutralize cells starting with `=`, `+`, `-` or `@`.
- NFR-SEC-11: HTTPS everywhere; database and storage are encrypted at rest.

### Privacy

- NFR-PRV-1: All data is stored in an Israel cloud region.
- NFR-PRV-2: Daily backups with point-in-time restore.
- NFR-PRV-3: A retention policy for signed documents and logs, agreed with HR.
- NFR-PRV-4: Requirements under Israeli privacy law and its data security regulations are checked with a legal or privacy advisor before launch.
- NFR-PRV-5: If the email provider is outside Israel, the email content (name, link, signed copy) passes through it. This must be accepted, or an Israel-region provider chosen.

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
- NFR-HEB-3: Text drawn on PDFs uses an embedded Hebrew font and right-to-left ordering. Testing includes names that mix Hebrew, numbers and hyphens.
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

### Assumptions

- Each department has one ready PDF that needs only name, ID number, date and signature.
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
- [ ] The signing page opens through at least one common filtered-internet service.
