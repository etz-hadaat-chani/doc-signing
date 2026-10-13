# Development Tasks

Run one task per Claude Code session. Start each session with:
"Read CLAUDE.md and the PRD sections this task needs. Do task N."
Commit after each task. Don't start the next task until "Done when" passes.

Order: Phase 0 → 1 → 2 → (3 and 4 in parallel) → 5 and 6 → 7.
Start the filter whitelisting in task 7.7 now; it needs no code.

Progress: tick `[x]` when a task is done.

---

## Phase 0: Project setup

### [x] 0.1 Code structure
- **Build:** pnpm workspace with `apps/api` (NestJS), `apps/web` (React + Vite), `packages/shared` (types, enums, zod schemas). TypeScript strict, ESLint, Prettier.
- **Depends on:** —
- **Done when:** `pnpm dev` starts both apps; lint and typecheck pass.

### [x] 0.2 Local services
- **Build:** Docker Compose with PostgreSQL 16, MinIO (S3-compatible storage), Mailpit (catches test emails). `.env.example`.
- **Depends on:** 0.1
- **Done when:** `docker compose up` starts all three; the API connects to the database.

### [x] 0.3 CLAUDE.md
- **Build:** Place CLAUDE.md in the root; make sure every command in it works.
- **Depends on:** 0.1
- **Done when:** The file exists and its commands run.

### [x] 0.4 Automatic checks (CI)
- **Build:** GitHub Actions running lint, typecheck and tests on every push.
- **Depends on:** 0.1
- **Done when:** The pipeline passes on the main branch.

---

## Phase 1: Database

### [x] 1.1 Prisma and enums
- **Build:** Prisma setup and all enums from PRD section 12.
- **Depends on:** 0.2
- **Done when:** The first migration runs.

### [x] 1.2 Employee tables
- **Build:** `users`, `departments`, `employees` (employee_number and id_number unique), `import_batches`.
- **Depends on:** 1.1
- **Done when:** Migration runs; unique rules are enforced.

### [x] 1.3 Template tables
- **Build:** `templates`, `template_departments`, `template_fields`.
- **Depends on:** 1.2
- **Done when:** Migration runs; a template can link to several departments.

### [x] 1.4 Round tables
- **Build:** `rounds`, `round_templates` (raw-SQL `UNIQUE NULLS NOT DISTINCT`), `assignments`, `email_messages`, `assignment_responses`.
- **Depends on:** 1.3
- **Done when:** Migration runs; a test shows two NULL-department rows in one round are rejected.

### [x] 1.5 Log, settings, indexes, seed data
- **Build:** `audit_log`, `settings`, all indexes from PRD section 12. The database blocks UPDATE, DELETE and TRUNCATE on `audit_log` (triggers), so rows can't change even outside the app. Seed script: 1 manager, 1 officer, 3 departments, 20 employees, default settings.
- **Depends on:** 1.4
- **Note:** `resetDatabase()` (apps/api/test/setup/database.ts) empties tables with TRUNCATE, so once the `audit_log` TRUNCATE trigger exists the test reset must bypass it, e.g. `SET session_replication_role = replica` in the same session as the TRUNCATE (needs superuser). Test database only; never in app code.
- **Done when:** `pnpm db:seed` works and can be run again safely.

### [x] 1.6 Shared logic
- **Build:** Israeli ID check-digit validator; `normalizeIdNumber()` (number or text → 9-digit text with leading zeros put back; used by the import, task 3.3); `displayStatus()` combining status with locked/expired flags; Hebrew status labels; unit tests, including one that fails if the shared enum values differ from the Prisma enums.
- **Depends on:** 0.1
- **Note:** The seed test (apps/api/test/db/seed.db.spec.ts) has its own `isValidIsraeliId` helper; replace it with the shared validator.
- **Done when:** Tests pass, including invalid IDs and IDs with leading zeros.

---

## Phase 2: Back-end foundation

### [x] 2.1 API skeleton
- **Build:** Config module, Prisma service, global error filter (Hebrew messages, standard error format), `/health`.
- **Depends on:** 1.5
- **Done when:** `/health` returns OK including database status.

### [x] 2.2 Staff login
- **Build:** `/api/auth/login`, `logout`, `me`. Argon2, secure session cookie stored in Postgres, login attempt limit.
- **Depends on:** 2.1
- **Done when:** A seed user logs in; a wrong password is refused; the cookie has secure flags.

### [ ] 2.3 Role checks
- **Build:** `@Roles()` and `@Public()` decorators plus a global guard; default is deny.
- **Depends on:** 2.2
- **Done when:** Officer gets 403 on a manager-only route; signed-out user gets 401.

### [ ] 2.4 Activity log
- **Build:** `AuditService` recording user, action, entity, IP, details.
- **Depends on:** 2.1
- **Note:** Log `auth.login` (success), `auth.login_failed` (email typed, IP; never the password) and `auth.logout` in `audit_log` from AuthService (2.2).
- **Done when:** Rows are written; no way to update or delete them.

### [ ] 2.5 File storage
- **Build:** S3-compatible storage adapter: upload, download, stream, short-lived download links.
- **Depends on:** 2.1
- **Done when:** Tests save and read a PDF; download links expire.

### [ ] 2.6 Email
- **Build:** Email adapter interface, SMTP implementation for Mailpit, 3 Hebrew RTL HTML emails (invitation, reminder, signed copy).
- **Depends on:** 2.1
- **Done when:** All 3 emails arrive in Mailpit, right to left.

### [ ] 2.7 Job queue and worker
- **Build:** pg-boss setup; separate worker process from the same code.
- **Depends on:** 2.1
- **Note:** Daily cleanup job: delete `sessions` past their absolute or idle limit and `login_attempts` older than 1 day (tables from 2.2).
- **Done when:** A test job added by the API is run by the worker.

---

## Phase 3: Back-end features

### [ ] 3.1 Staff users API
- **Build:** `/api/users` list, create, update (manager only).
- **Depends on:** 2.3
- **Note:** Disabling a user also deletes their sessions (2.2 already refuses them on the next request). Resetting a user's password deletes all of that user's sessions, like disabling does. Store the email lowercased (login lowercases it before lookup).
- **Done when:** Create an officer, disable a user; a disabled user can't log in.

### [ ] 3.2 Employees API
- **Build:** Departments list; employees list with search, filters, paging; employee card; create and edit.
- **Depends on:** 2.3
- **Done when:** Search by name, employee number or ID; filter by department and email status.

### [ ] 3.3 Excel import: preview
- **Build:** Read the Har Gal employee export `.xlsx` (ExcelJS), validate every row, compute new / updated / unchanged / errors plus new and renamed departments, save `import_batch` as preview.
- **Depends on:** 3.2, 1.6
- **Note (Har Gal export, PRD FR-EMP-1, FR-EMP-3):**
  - Find columns by these exact Hebrew headers, in any order; ignore every other column: מספר עובד, תעודת זהות, שם פרטי, שם משפחה, מחלקה, E-Mail, קידומת, טלפון, נייד פרטי - קידומת, נייד פרטי - מספר. A missing header fails the file.
  - מספר עובד and תעודת זהות arrive as numbers: convert to text (no `.0`, no exponent); the ID gets its leading zeros back with `normalizeIdNumber` (1.6).
  - מחלקה is "code - name", e.g. "15 - ממלאות מקום ירושלים", "5 - ממ חינוך מיוחד", "45 - ממלאות מקום אלעד-45". Pattern: digits, optional spaces, "-", optional spaces, name (`^(\d+)\s*-\s*(.+)$`), split at the **first** hyphen only, since names can contain hyphens and numbers. Code must be > 0; trim the name. A cell that doesn't match is an error row.
  - Departments match by code. Unknown code → "new department"; known code with a different name → "department renamed". Both are listed in the preview.
  - Phone = נייד פרטי - קידומת + נייד פרטי - מספר if present, otherwise קידומת + טלפון, as `050-1234567`; a prefix that arrived as a number (`50`) gets its leading 0 back. Reference only.
  - Empty E-Mail → `email_status = missing`.
  - Tests: build a fake `.xlsx` in the test with the same headers (plus a few extra columns to ignore) and made-up data only, never the real export. Include a department name with a hyphen, an ID that lost its leading 0, a row with no email, and planted errors.
  - Har Gal is the main source (PRD FR-EMP-2, FR-EMP-4): every updated employee lists each change as "field: old → new" (e.g. `email: a@x.com → b@x.com`), including changes that overwrite a manual edit. "Unchanged" means no field differs.
- **Done when:** A test file with planted errors gives exact counts and reasons; employee table unchanged.

### [ ] 3.4 Excel import: confirm
- **Build:** Upsert employees by employee number, create confirmed departments, set email status, log it.
- **Depends on:** 3.3
- **Note (PRD FR-EMP-4, FR-EMP-5):**
  - Departments are upserted by **code**: create confirmed new codes and apply "department renamed" (update the name by code). Never match a department by name.
  - Employees are upserted by `employeeNumber`; employees missing from the file are never deactivated.
  - Har Gal is the main source: the import overwrites every field it carries, including manual edits (PRD FR-EMP-4, FR-EMP-7). Apply exactly the changes shown in the preview.
  - Email status (PRD FR-EMP-4): email same as stored → keep `email_status` as it is (bounced stays bounced); different → `valid`, or `invalid` if the format is wrong; empty → `missing`. Compare emails after trimming and lowercasing. Phone stored as `050-1234567` (see 3.3).
  - Never send anything from the import (PRD FR-EMP-6). An employee whose email was added keeps their `no_email` assignments as they are; they show in manual handling as "email added, ready to send" (3.16).
  - Test: importing an email for an employee with a `no_email` assignment queues no job and sends no email.
- **Done when:** Running the same import twice changes nothing; missing employees untouched.

### [ ] 3.5 Templates API
- **Build:** Upload PDF (check type and size), link departments, save field positions, archive. Lock after send; edits create a new version.
- **Depends on:** 2.5, 2.3
- **Note:** A department may be linked to more than one active template (not archived, no newer version). Don't block it; the manager picks one per department when creating a round (3.8).
- **Done when:** Editing a locked template creates version 2.

### [ ] 3.6 Personalized PDF
- **Build:** pdf-lib + fontkit + Hebrew font + bidi-js: draw name, ID, date at stored positions. Preview endpoint.
- **Depends on:** 3.5
- **Done when:** Snapshot tests with names like "כהן-לוי 2" read correctly right to left.

### [ ] 3.7 Signed PDF
- **Build:** Draw signature image, date, footer; flatten; return file + SHA-256. Validate signature image (PNG, size, not empty).
- **Depends on:** 3.6
- **Done when:** Output has no form fields; hash matches; empty signature refused.

### [ ] 3.8 Recipient preview
- **Build:** Resolve recipient choice (all / departments / chosen / one) and template per department. Return counts: will send, no email, already signed, departments missing a template.
- **Depends on:** 3.4, 3.5
- **Note:** In by-department mode a department may have more than one active template. The manager picks one; the choice is saved in `round_templates` (1.4). Warn when a department has none, and ask for a choice when it has several.
- **Done when:** Tests for every choice type, including combinations.

### [ ] 3.9 Create a round
- **Build:** Round + round templates + one assignment per employee (`pending` or `no_email`).
- **Depends on:** 3.8
- **Note:** A `single_template` round has exactly one `round_templates` row with `department_id` NULL; a `by_department` round has none (one row per department instead). Enforced in the service, not the database.
- **Note (department snapshot):** Save each assignment's `department_id` = the employee's department at the moment the round is created. It never changes afterwards, even if a later import moves the employee. Template choice in `by_department` mode uses the same value.
- **Done when:** No duplicate employees in a round; right template per department.

### [ ] 3.10 Bulk sending
- **Build:** `POST /rounds/:id/send` enqueues jobs; worker sends in batches, creates a token per email (hash only) in `email_messages`, status → sent; round `sending` → `active`.
- **Depends on:** 3.9, 2.6, 2.7
- **Done when:** Sending to 50 employees puts 50 emails in Mailpit, each with a unique link.

### [ ] 3.11 Reading rounds
- **Build:** Round details with counts, per-employee list with filters, round list with % signed, dashboard summary.
- **Depends on:** 3.10
- **Note:** The round's department filter, the department shown per row and the counts by department use `assignments.department_id` (department at send time, index `(round_id, department_id)`), not the employee's current department. Test: move an employee after the round is created; the round still counts them in the old department.
- **Done when:** Counts match the data; lists are paged.

### [ ] 3.12 Round actions
- **Build:** Remind (one or whole round), resend, unlock, cancel (one or whole round). All logged.
- **Depends on:** 3.10
- **Note:** Unlock clears `locked_at` AND resets `failed_attempts` to 0 (the database CHECK allows at most 5).
- **Done when:** Tests per action with correct status changes.

### [ ] 3.13 Public signing API
- **Build:** `GET /sign/:token` (state only); `verify` (lock at 5, IP rate limit, 15-min session, status → opened); `document`; `submit` (build signed PDF, save to `round/department/employeeNumber_name.pdf`, status → signed, queue signed-copy email, close all links).
- **Depends on:** 3.7, 3.10
- **Note:** The `department` folder in the signed file path comes from `assignments.department_id` (department at send time), not the employee's current department.
- **Note:** `submit` needs a higher JSON body size limit for the signature image (Express default is 100 KB); raise it for that route only.
- **Note:** Configure Express "trust proxy" for the cloud load balancer so `req.ip` is the employee's real IP (used for `signer_ip` and the per-IP rate limit). See also 7.6.
- **Done when:** Signing via an old reminder link works; 6th wrong attempt refused; link shows "Already signed" afterwards.

### [ ] 3.14 Reminder job
- **Build:** Daily job 09:00 Sun–Thu (Asia/Jerusalem); reminds everyone due; no limit unless set; idempotent, single instance.
- **Depends on:** 3.10
- **Done when:** Running twice the same day sends no duplicates; signed or expired employees skipped.

### [ ] 3.15 Bounce webhook
- **Build:** `/api/webhooks/email`: verify provider signature, mark email bounced, status → `invalid_email`. Test provider stub.
- **Depends on:** 3.10
- **Done when:** A test bounce changes the status.

### [ ] 3.16 Manual handling API
- **Build:** Print endpoint, scanned signature upload (`signed_manual`), office kiosk session, manual-handling list.
- **Depends on:** 3.13
- **Note (PRD FR-EMP-6, FR-MAN-1):** The list marks open `no_email` assignments whose employee now has a `valid` email (for example, added by an import) as "email added, ready to send". A manager-only send action (one or several) sends a normal invitation with a new token, status → `sent`, and logs it. Nothing is sent without that action.
- **Done when:** Tests per action; kiosk still requires the ID number.

### [ ] 3.17 Exports and file access
- **Build:** Status export to Excel (formula-safe), ZIP of signed files streamed by department with UTF-8 names, signed-document links that log each view.
- **Depends on:** 3.13
- **Note:** The Excel export's department column and the ZIP's department folders use `assignments.department_id` (department at send time), matching the signed file paths from 3.13.
- **Done when:** ZIP opens in Windows with Hebrew names; a cell starting with `=` is neutralized.

### [ ] 3.18 Settings API
- **Build:** Read/update default reminder interval, link expiry, sender name.
- **Depends on:** 2.3
- **Note:** The seed doesn't run in production, so the settings code has built-in defaults used when a key is missing: `reminder_interval_days` 3, `max_reminders` null (no limit), `link_expiry_days` 60, `sender_name` "מערכת חתימות".
- **Done when:** New rounds pick up the defaults.

---

## Phase 4: Front-end foundation

### [ ] 4.1 App shell
- **Build:** MUI with RTL (stylis-plugin-rtl), Heebo font, router, Hebrew texts file, side menu, TanStack Query client, login page, role-aware routes.
- **Depends on:** 2.2
- **Done when:** Login works; officer doesn't see manager-only menu items.

### [ ] 4.2 Shared components
- **Build:** Status chip (Hebrew labels, colors), table with paging and filters, confirm dialog, file upload, notifications.
- **Depends on:** 4.1
- **Done when:** Components shown on a demo page, right to left.

---

## Phase 5: Management screens

### [ ] 5.1 Dashboard (A2)
- **Build:** Totals and rounds needing attention.
- **Depends on:** 4.2, 3.11
- **Done when:** Numbers match the API.

### [ ] 5.2 Employees (A6, A7)
- **Build:** List, employee card with history, add/edit (manager only).
- **Depends on:** 4.2, 3.2
- **Done when:** Search and filters work; officer can't edit.

### [ ] 5.3 Import wizard (A8)
- **Build:** Upload, error report, preview, confirm.
- **Depends on:** 5.2, 3.4
- **Done when:** Full import from the UI with the test file.

### [ ] 5.4 Templates (A9)
- **Build:** List, upload, department picker, number fields for positions, live PDF preview.
- **Depends on:** 4.2, 3.6
- **Done when:** Changing a position updates the preview.

### [ ] 5.5 New round wizard (A5)
- **Build:** Steps: name and mode, recipients, summary with counts, settings, preview, send.
- **Depends on:** 4.2, 3.8–3.10
- **Done when:** A round can be sent to one employee and to whole departments.

### [ ] 5.6 Rounds (A3, A4)
- **Build:** Round list; round details with filters, search, export, ZIP, actions.
- **Depends on:** 5.5, 3.11, 3.12, 3.17
- **Done when:** Every action works and status refreshes.

### [ ] 5.7 Manual handling (A10)
- **Build:** List, print, upload scan, fix email, open office kiosk.
- **Depends on:** 4.2, 3.16
- **Note:** Show "email added, ready to send" on assignments that have one, with a one-click send button (and a send-all for the selected rows). Near "fix email", remind the manager to fix it in Har Gal too, since the next import overwrites it (PRD FR-EMP-7).
- **Done when:** Each path changes the status correctly.

### [ ] 5.8 Settings and staff users (A11, A12)
- **Build:** Forms for settings and staff users.
- **Depends on:** 4.2, 3.1, 3.18
- **Done when:** Changes are saved and logged.

---

## Phase 6: Employee signing screens

### [ ] 6.1 Signing pages and messages (B5)
- **Build:** `/sign/:token` checks link state; expired / signed / locked / cancelled messages with HR contact.
- **Depends on:** 4.1, 3.13
- **Done when:** Each state shows the right Hebrew message.

### [ ] 6.2 ID check (B1)
- **Build:** ID field, errors, locked state.
- **Depends on:** 6.1
- **Done when:** Wrong ID shows an error; 5 wrong attempts show the locked page.

### [ ] 6.3 Document view (B2)
- **Build:** PDF shown with pdf.js; Sign button active only after scrolling to the end.
- **Depends on:** 6.2
- **Done when:** Tested on Chrome, Edge, Firefox on Windows.

### [ ] 6.4 Signature and done (B3, B4)
- **Build:** signature_pad ≥ 500×200 with smoothing, Clear, reading statement, submit, done screen; office kiosk variant.
- **Depends on:** 6.3
- **Done when:** A mouse signature appears in the stored PDF.

---

## Phase 7: Integration, testing and launch

### [ ] 7.1 End-to-end test
- **Build:** Playwright: import → template → round → open link from Mailpit → sign → status signed → file in storage.
- **Depends on:** Phase 6
- **Done when:** Passes in CI.

### [ ] 7.2 Security pass
- **Build:** Helmet headers and CSP, CSRF protection, review of rate limits, test listing every route and confirming a role check.
- **Depends on:** 7.1
- **Done when:** No route without a role check except `/sign/*`, login, webhook.

### [ ] 7.3 Hebrew quality check
- **Build:** PDFs with mixed names, emails in Outlook and Gmail, Hebrew ZIP names on Windows.
- **Depends on:** 7.1
- **Done when:** Checklist signed off.

### [ ] 7.4 Load test
- **Build:** Round of 1,500 recipients with a fake email provider; time dashboard and list queries.
- **Depends on:** 7.1
- **Done when:** Sending finishes cleanly; lists load in under 1 second.

### [ ] 7.5 Real email provider
- **Build:** Provider adapter (SES or Postmark) and its bounce webhook; SPF, DKIM, DMARC setup notes.
- **Depends on:** 3.15
- **Done when:** Test emails pass SPF, DKIM and DMARC.

### [ ] 7.6 Deployment
- **Build:** Docker images, migrations on deploy, secrets, backups, Israel region. Needs the AWS/Azure decision.
- **Depends on:** 7.2, 7.5
- **Note:** In production the app connects as a separate non-owner database role with no UPDATE, DELETE or TRUNCATE on `audit_log` (an owner could disable its triggers); migrations run as the owner.
- **Note:** Set Express "trust proxy" to match the real proxy chain (e.g. one hop) so `req.ip` is the client's IP, not the load balancer's (see 3.13). Don't trust all hops: `X-Forwarded-For` could then be spoofed.
- **Note:** The seed refuses to run in production, so add a one-time command to create the first manager there.
- **Done when:** Test environment is up; a backup restore has been tried.

### [ ] 7.7 Filter whitelisting and pilot
- **Build:** Whitelist with NetFree, Etrog, Nativ, Rimon; test from each; pilot with one department.
- **Depends on:** 7.6 (start the whitelisting requests now)
- **Done when:** Signing works through all 4 filters; pilot department over 80% signed.
