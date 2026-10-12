# Digital Document Signing & Tracking System

pnpm monorepo.

| Path              | What                                                 |
| ----------------- | ---------------------------------------------------- |
| `apps/api`        | NestJS API (ESM), served under `/api` on port 3000   |
| `apps/web`        | React + Vite + TypeScript, port 5173, proxies `/api` |
| `packages/shared` | Types, enums and Zod schemas used by both apps (ESM) |

## Requirements

- Node.js 22 or newer
- pnpm (the version is pinned in `package.json`; run `corepack enable` once)

## Local services

PostgreSQL, MinIO (S3-compatible storage) and Mailpit (catches test emails) run in Docker.

```sh
cp .env.example .env    # repo root; read by docker compose and the API
docker compose up -d    # minio-init creates the `documents` bucket, then exits
docker compose ps       # postgres, minio, mailpit should be "healthy"
```

| Service    | Port | URL / connection                                          |
| ---------- | ---- | --------------------------------------------------------- |
| PostgreSQL | 5432 | `postgresql://docsign:docsign@localhost:5432/docsign`     |
| MinIO API  | 9000 | http://localhost:9000 (S3 endpoint)                       |
| MinIO UI   | 9001 | http://localhost:9001 (login `minioadmin` / `minioadmin`) |
| Mailpit    | 1025 | SMTP, no auth                                             |
| Mailpit UI | 8025 | http://localhost:8025                                     |

- The free MinIO console only browses files; bucket and user admin need `mc`.
- MinIO uses the `pgsty/minio` community build, because the official images stopped in 2025. It's for local dev only; production uses AWS S3 or Azure Blob.
- The API checks the database at startup and exits if it can't connect.
- If you change `POSTGRES_PORT`, change the port in `DATABASE_URL` to match.

## Commands

```sh
pnpm install
pnpm db:migrate    # prisma migrate dev (apps/api/prisma)
pnpm db:seed       # prisma db seed; safe to run repeatedly
pnpm dev           # builds shared, then runs shared (watch), api and web together
pnpm test          # Vitest in every package
pnpm test:e2e      # Playwright (apps/web/e2e, files named *.e2e.ts); needs `pnpm dev` running
pnpm typecheck     # all packages
pnpm lint          # ESLint across the repo (typed rules)
pnpm format        # Prettier write; format:check to verify
pnpm build
```

Behind a filtering proxy that intercepts HTTPS (e.g. NetFree), Prisma can't download its engines
("unable to get local issuer certificate"). Let Node trust the Windows certificate store, once per machine:

```sh
setx NODE_OPTIONS --use-system-ca
```

## How `@doc-signing/shared` is consumed

- **API** imports the compiled output in `packages/shared/dist`. In `pnpm dev`, the shared package runs `tsc --watch`.
- **Web** reads `packages/shared/src` directly, through a Vite alias and a TS `paths` entry, so it needs no build step and changes hot-reload.
