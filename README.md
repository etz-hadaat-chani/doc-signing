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

## Commands

```sh
pnpm install
pnpm dev           # builds shared, then runs shared (watch), api and web together
pnpm typecheck     # all packages
pnpm lint          # ESLint across the repo (typed rules)
pnpm format        # Prettier write; format:check to verify
pnpm build
```

## How `@doc-signing/shared` is consumed

- **API** imports the compiled output in `packages/shared/dist`. In `pnpm dev`, the shared package runs `tsc --watch`.
- **Web** reads `packages/shared/src` directly, through a Vite alias and a TS `paths` entry, so it needs no build step and changes hot-reload.
