# CLAUDE.md

Full spec: [PRD.md](PRD.md) in the repo root, the **only source of truth** — read only the sections a task names. Don't use the Claude Docs connector or any online copy of the PRD; update PRD.md itself when the spec changes.

## 1. Project overview
Internal web system that sends personalized PDFs to ~1,500 employees, collects a mouse-drawn signature, stores the signed PDF by department and emails the employee a copy. Managers and officers track every employee's status in real time; reminders go out automatically until signed. UI is **Hebrew only, RTL**.

## 2. Tech stack
- **Monorepo:** pnpm workspaces, TypeScript everywhere (strict)
- **Front end:** React + Vite, MUI with RTL (stylis-plugin-rtl), Heebo font, TanStack Query, React Router, pdf.js, signature_pad
- **Back end:** Node.js + NestJS, Prisma, zod (shared schemas)
- **DB:** PostgreSQL 16 · **Jobs:** pg-boss (queue + cron inside Postgres, no Redis)
- **PDF:** pdf-lib + fontkit + bidi-js (Hebrew RTL drawing)
- **Excel:** ExcelJS · **Passwords:** Argon2
- **Storage:** S3-compatible (MinIO locally; AWS S3 or Azure Blob in prod — undecided, keep behind adapter)
- **Email:** adapter; Mailpit (SMTP) locally, SES/Postmark in prod
- **Tests:** Vitest (unit), Supertest (API), Playwright (E2E)
- **Hosting:** cloud, Israel region (provider TBD)

## 3. Architecture
Modular monolith, one codebase, **two processes**: `api` (HTTP) and `worker` (jobs). API enqueues; worker sends emails, runs reminders, builds signed PDFs.

| Module | Responsibility |
|---|---|
| Auth & Users | Staff login (session cookie), roles `manager` / `officer` |
| Employees & Import | CRUD, Excel import (preview → commit), upsert by `employee_number` |
| Templates | Department PDFs + stored field positions, versioning/locking |
| PDF Filler | Draw name/ID/date on the fly; finalize: signature + footer + flatten + SHA-256 |
| Rounds (send campaigns) | Pick recipients, resolve template per department, create assignments, bulk send |
| Signing (public) | `/sign/:token`: ID check → view → sign → submit |
| Status Tracker | Dashboard, round details, exports (Excel, ZIP), manual handling |
| Reminder Engine | Daily cron 09:00 Sun–Thu Asia/Jerusalem |
| Email & Webhooks | Invite / reminder / signed copy; bounce handling |
| Audit | Append-only action log |

## 4. Core entities
- **User** — email, passwordHash, role (manager|officer), isActive
- **Department** — code (int, unique, > 0, Har Gal department number = identity), name (not unique, can change; import updates it by code). Displayed as "15 - name"
- **Employee** — employeeNumber (unique, import key), idNumber (char 9, unique, signing check), first/lastName, departmentId, email?, emailStatus (valid|missing|invalid|bounced), phone (reference only), isActive
- **ImportBatch** — file, status (preview|committed|failed), counts, errors jsonb
- **Template** — name, kind (signature; later acknowledgment|external_report), fileKey, version, parentTemplateId, isLocked; M:N departments via **TemplateDepartment**
- **TemplateField** — templateId, fieldType (full_name|id_number|date|signature; later checkbox|text), page, x, y, width, height
- **Round** — name, mode (single_template|by_department), status (draft|sending|active|closed|cancelled), reminderIntervalDays=3, maxReminders=NULL (no limit), linkExpiresAt (default +60d)
- **RoundTemplate** — roundId, departmentId? (NULL = all), templateId; UNIQUE NULLS NOT DISTINCT
- **Assignment** (core: employee × round) — departmentId (employee's department when the round was created; never changes; used for round filters/counts, signed file folder, ZIP), status (pending|sent|opened|signed|signed_manual|no_email|invalid_email|cancelled), failedAttempts, lockedAt, reminderCount, timestamps, signMethod (digital|manual|kiosk), signedFileKey, signedFileSha256, signerIp; UNIQUE(roundId, employeeId)
- **EmailMessage** — assignmentId, type (invite|reminder|signed_copy), tokenHash (unique), providerMessageId, status
- **AssignmentResponse** (later) · **AuditLog** (append-only) · **Setting** (key/jsonb)

PKs `uuid`, dates `timestamptz`. `ON DELETE RESTRICT` everywhere — archive, never delete.

## 5. Folder structure
```
apps/
  api/src/
    modules/<module>/   # controller, service, dto, *.spec.ts per module
    worker/             # worker entry + job handlers
    common/             # guards, filters, interceptors, adapters (storage, email)
  api/prisma/           # schema.prisma, migrations, seed.ts
  web/src/
    admin/              # management screens (A1–A12)
    sign/               # employee signing flow (B1–B5)
    components/  api/  i18n/he.ts  theme/
packages/shared/        # enums, zod schemas, ID validator, status helpers
docker-compose.yml      # postgres, minio, mailpit
```

## 6. Business rules (do not break)
- **No SMS anywhere.** Employees are Orthodox — no smartphones. Design signing for **desktop + mouse**; touch is a bonus.
- **Signing auth:** unique link + employee types their **ID number**. 5 wrong attempts → `lockedAt` set; manager unlocks. Rate-limit per IP. 15-min signing session cookie.
- **Tokens:** 256-bit random, store only SHA-256. **New token per email** (invite and each reminder); all valid until signed, cancelled or expired. After signing every link shows "already signed".
- **No personal data in URLs or email bodies** beyond name and document name. `GET /sign/:token` returns state only.
- **"Opened" = correct ID entered**, not email open tracking.
- **Locked / expired are flags, not statuses** — compute display status with `displayStatus()`.
- **PDF personalization:** draw name, ID number and date at `TemplateField` positions on the department's original PDF (do NOT use AcroForm fields). Embedded Hebrew font + bidi ordering.
- **Signed PDF:** signature + date + footer (date, time, reference), flattened, SHA-256 stored. Path: `rounds/{roundId}/{departmentCode}/{employeeNumber}.pdf`, department = `assignments.departmentId` (at send time). Storage keys are ASCII only; Hebrew names only in download names and the ZIP. Uploads never overwrite.
- **After signing:** status `signed`, reminders stop, signed copy emailed automatically (PDF attached).
- **Templates:** locked after first send; edits create a new version.
- **Rounds are flexible:** all / departments / hand-picked / single employee; by-department mode picks each department's template and warns if one is missing.
- **Reminders:** every 3 days until signed, no max by default; stop on sign, cancel or link expiry. Job must be idempotent and single-instance.
- **Excel import:** the Har Gal employee export as is; columns found by exact Hebrew header names, others ignored (TASKS.md 3.3); department cell "code - name" split at the first hyphen, departments matched by **code**, never by name; validate (ID check digit, duplicates, email, department); preview before commit; upsert by `employeeNumber`; **never deactivate employees missing from a file** (exports may be per department). Har Gal is the main source: an import overwrites manual edits (preview shows "field: old → new"). Email status: same email → keep status (bounced stays bounced); different → valid/invalid; empty → missing. **An import never sends anything.**
- **No email / bounced:** handled manually — print personalized PDF, upload scan (`signed_manual`), or office kiosk (employee still enters ID). An email added later shows as "email added, ready to send"; the manager sends with one click.
- **Roles:** manager = everything; officer = read-only (dashboard, statuses, signed docs, exports). Enforce on the server for every route.
- **Every important action → AuditLog** (sends, imports, signs, document views, unlocks).

## 7. Conventions
- TypeScript strict, no `any`. ESLint + Prettier. Names in English; all user-facing text in Hebrew from `web/src/i18n/he.ts` (no inline strings).
- Validate all input with zod schemas from `packages/shared`; reuse them in the front end.
- **API:** REST under `/api`, JSON, camelCase. Lists → `{ items, total, page, pageSize }`. Errors → `{ error: { code: "SNAKE_CASE", message: "<Hebrew>", details? } }` via one global exception filter. Correct HTTP codes (400 validation, 401, 403, 404, 409 conflict, 423 locked, 429).
- Every route needs `@Roles(...)` or `@Public()`; default is deny.
- Business logic in services, not controllers. External services (storage, email) only through adapters.
- **Layering:** each feature module has controller (HTTP only: input, output, decorators) → service (business rules) → data access. Controllers never use `PrismaService`. Simple single-table reads/writes may stay in the service. Complex or shared queries (joins, counts, queries used by more than one service, and **all assignment status changes**) go in a `<feature>.repository.ts` inside the module. Multi-step changes run in one transaction started by the service (`prisma.$transaction(async (tx) => …)`); methods that take part accept an optional `db: Db = this.prisma` (`common/prisma/prisma.types.ts`).
- Dates stored UTC; displayed `DD/MM/YYYY` in `Asia/Jerusalem`.
- Excel exports: neutralize cells starting with `= + - @`. ZIP names UTF-8.
- Tests: unit tests for logic, API tests for every endpoint's happy path + permissions. Tests must pass before commit.
- While working, run only the test files you create or change (`pnpm --filter @doc-signing/api exec vitest run <file>`, or `vitest run --changed`). Run the full set only once, at the end, right before the commit: CI runs everything, and only a full run catches a change that breaks older code. If it fails, fix it, run only the failing files again, then the full set once more.
- Before every commit run all four checks CI runs: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`. ESLint doesn't check formatting; fix it with `pnpm format`, then lint again (Prettier may rewrap a line away from its `eslint-disable-next-line` comment).
- Small commits, one task per session. Migrations via Prisma only; never edit an applied migration.
- Migration order: some migrations have hand-written timestamps (e.g. `20261013140000`). Every new migration folder name must sort after the newest existing one. Create it with `prisma migrate dev --create-only --name <name>`; if Prisma's timestamp is earlier, rename the folder before applying it.
- Python is not installed on this machine. For helper scripts use Node.js (node -e or a .mjs file), never python.

## Commands
```
pnpm install
docker compose up -d
pnpm db:migrate && pnpm db:seed
pnpm dev            # api + worker + web
pnpm test           # unit + api
pnpm test:e2e
pnpm email:preview  # the 3 emails with sample data → Mailpit (http://localhost:8025)
pnpm lint && pnpm typecheck
pnpm format:check   # pnpm format fixes it
```
