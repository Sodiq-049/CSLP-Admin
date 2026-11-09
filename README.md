# CSLP — Computer Science Learning Platform

Monorepo for the Admin Portal, Student Website, Mobile App and their shared NestJS API.
Architecture and decisions: [docs/](docs/README.md).

## Requirements

- Node 22.12+ (`.nvmrc`), pnpm 9 (`corepack enable`)
- Docker (only for the local dev stack; tests do not need it)

## Getting started

```bash
pnpm install
pnpm build                       # builds packages in dependency order (Turborepo)
pnpm infra:up                    # MongoDB Atlas Local :27018, Redis :6380, SeaweedFS S3 :8333, Mailpit :8025
cp apps/api/.env.example apps/api/.env   # then fill JWT_ACCESS_SECRET, MFA_ENCRYPTION_KEY, SEED_*
pnpm seed                        # super admin + YABATECH shell (idempotent)
pnpm --filter @cslp/api dev      # http://localhost:4000/api/v1  ·  Swagger: /api/docs
pnpm dev:admin                   # http://localhost:3001  (proxies /api to API_URL, default :4000)
pnpm dev:worker                  # background jobs: document processing, outline detection (needs Redis + S3)
```

Generate secrets with `openssl rand -base64 48` (JWT) and `openssl rand -base64 32` (MFA key).
The seeded super admin is asked to enrol an authenticator app on first sign-in.

Host ports deliberately avoid 27017/6379 so CSLP can run next to other local projects
(override with `CSLP_MONGO_PORT` / `CSLP_REDIS_PORT`). Local S3 credentials: `cslp` / `cslp-dev-password`.

## Everyday commands

| Command                   | What it does                                                              |
| ------------------------- | ------------------------------------------------------------------------- |
| `pnpm test`               | All unit + integration tests (in-memory MongoDB, mocked providers)        |
| `pnpm typecheck`          | Strict TypeScript across the repo                                         |
| `pnpm e2e`                | Builds API + admin and runs the Playwright suite (needs `pnpm infra:up`)  |
| `pnpm contracts:generate` | Rebuild `docs/openapi.json` and the typed client in `packages/api-client` |
| `pnpm contracts:check`    | CI guard: fails if the spec or client is out of date                      |

## Layout

```
apps/admin          Next.js Admin Portal (sign-in + MFA, academic structure, administrators, settings)
apps/api            NestJS HTTP API (auth, RBAC, academic structure, admin users)
apps/worker         BullMQ worker running the shared processors from server-core
packages/server-core  Mongoose schemas, domain services, tenant isolation (shared by api + worker)
packages/validation   Zod contracts — the source of truth for every request/response
packages/shared-types Roles, permissions, statuses, error codes
packages/api-client   Generated fetchers + TanStack Query hooks (Orval)
packages/design-tokens Colour, radius and typography tokens (light + dark, WCAG AA)
packages/config       Shared tsconfig presets
infrastructure/       docker-compose for local development
```

## Adding an endpoint

1. Define request/response schemas in `packages/validation` with `requestContract` / `responseContract`.
2. Implement the domain logic in `packages/server-core` (take a `TenantScope`, write audit logs).
3. Add the controller in `apps/api` with `@RequirePermission(...)`, `@ZodBody`, `@ApiOk`.
4. Add e2e tests (permissions + institution isolation), then `pnpm contracts:generate`.

## Optional services

- **AI providers:** set `OPENAI_API_KEY` plus `AI_MODEL_OUTLINE_EXTRACT` (and optionally `AI_EMBEDDINGS_*`) in `apps/api/.env`. Without them, outline topics are detected from the document layout and embeddings are skipped. Both are shown in the UI.
- **Malware scanning:** `docker compose -f infrastructure/docker-compose.yml --profile security up -d clamav`, then set `CLAMAV_HOST=localhost`.
