# 09 · Deployment & operations

How to run CSLP in production. Hosting is still an open decision (README), so this guide covers what any host needs: three containers, MongoDB Atlas, Redis, S3-compatible storage and SMTP.

## 1. Images

One root [`Dockerfile`](../Dockerfile) with three targets, all on Node 22 (non-root user, `tini` as PID 1):

```bash
docker build --target api    -t cslp-api .
docker build --target worker -t cslp-worker .
docker build --target admin  -t cslp-admin .
```

| Image    | Listens | Health                                                      | Scale                                              |
| -------- | ------- | ----------------------------------------------------------- | -------------------------------------------------- |
| `api`    | 4000    | `GET /api/v1/public/health` (Docker `HEALTHCHECK` built in) | Horizontally, behind a load balancer               |
| `worker` | none    | process up; BullMQ shows activity in logs                   | Horizontally; `WORKER_CONCURRENCY` per container   |
| `admin`  | 3000    | `GET /login` returns 200                                    | Horizontally (stateless Next.js standalone server) |

The scheduled-publishing sweep runs inside every worker, but a Redis lock (`cslp:scheduler-lock`) makes sure only one of them runs it each minute.

## 2. Managed services

| Service       | Requirement                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MongoDB Atlas | Replica set (transactions are used for bundles). Vector Search for retrieval: the worker creates the `chunks_vector` index on start-up. Turn on continuous backup. |
| Redis 7+      | For BullMQ and the scheduler lock. Use `noeviction` and persistence (AOF).                                                                                         |
| S3-compatible | One private bucket. API and worker share it; only presigned/streamed access, never public.                                                                         |
| SMTP          | Any transactional provider's SMTP relay (verification and password-reset mail). Set SPF/DKIM for the `MAIL_FROM` domain.                                           |
| OpenAI        | Optional; without a key, AI features report "not configured" and everything else works.                                                                            |

## 3. Configuration

All settings are environment variables, validated at start-up (the process exits with a clear list of problems). See [`apps/api/.env.example`](../apps/api/.env.example). The production essentials:

| Variable                                                             | Notes                                                                                                                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV=production`                                                | Turns off response-contract checks and refuses the `fake` AI providers.                                                                                     |
| `MONGODB_URI`, `REDIS_URL`                                           | API and worker.                                                                                                                                             |
| `JWT_ACCESS_SECRET`                                                  | 48+ random characters (`openssl rand -base64 48`). Rotating it signs everyone out.                                                                          |
| `MFA_ENCRYPTION_KEY`                                                 | 32 bytes base64. **Never rotate without re-encrypting** stored TOTP secrets.                                                                                |
| `ADMIN_APP_URL`, `STUDENT_APP_URL`                                   | Used in email links. `CORS_ORIGINS` lists the student web origin(s).                                                                                        |
| `COOKIE_SECURE` (defaults to true in production), `COOKIE_DOMAIN`    | Cookies are `httpOnly`, `SameSite=Lax`, CSRF double-submit.                                                                                                 |
| `S3_*`                                                               | Required whenever `REDIS_URL` is set (the worker can't read in-memory uploads).                                                                             |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`      | Without `SMTP_HOST`, mail is only logged. Don't do that in production.                                                                                      |
| `MFA_REQUIRED`                                                       | Default `false`: sign-in is email + password and users may turn on two-step verification in Settings. `true` forces it on Super/Institution Administrators. |
| `STUDENT_EMAIL_DOMAINS`                                              | Optional allow-list for student self-registration (e.g. the institution's domain).                                                                          |
| `OPENAI_API_KEY`, `AI_TEXT_PROVIDER`, `AI_MODEL_*`, `AI_PRICES_JSON` | See docs/06. Set `AI_PRICES_JSON` to see cost estimates.                                                                                                    |
| Admin: `API_URL`                                                     | Internal URL of the API; the admin server proxies `/api/*` to it at request time.                                                                           |

Keep secrets in the host's secret manager, never in images. The `.dockerignore` excludes every `.env` file.

## 4. First deployment

1. Provision the services in §2 and set the variables in §3.
2. Run the seed once (creates the super administrator and the YABATECH shell, no course data):
   `docker run --rm --env-file prod.env cslp-api node dist/scripts/seed.js`
3. Start `api`, `worker` and `admin`. Sign in as the super administrator (two-step verification is optional unless `MFA_REQUIRED=true`).
4. Break-glass recovery (lost MFA device): `docker run --rm --env-file prod.env cslp-api node dist/scripts/reset-admin.js <email> --reset-mfa`. It's audited; restrict who can run it.

## 5. Security baseline

- **API:** Helmet headers, `trust proxy` 1 (put exactly one proxy in front), global rate limit (300/min/IP) plus tighter limits on sign-in (5/min), MFA (10/min), registration, resend and forgot-password (5/hour) and quiz attempts (20/min). Account lockout after repeated failures. Argon2id passwords.
- **Accounts:** registration, resend and forgot-password give the same answer whether or not the email exists. Students can't sign in until they verify their email. Reset links last 1 hour and verification links 48 hours. Both are single-use and stored only as SHA-256 hashes. A password reset signs the user out everywhere.
- **Admin portal:** strict CSP (`'self'` only, no remote scripts, frames or objects), HSTS, `X-Frame-Options: DENY`, `nosniff`, no `X-Powered-By`.
- **Tenancy:** every institution-scoped query is checked by the Mongoose tenant plugin, and other institutions' records come back as 404.
- **Dependencies:** run `pnpm audit --prod` in CI and fail the build on high-severity issues.

## 6. Operations

- **Logs:** JSON (pino) on stdout with `requestId`. Auth headers and cookies are redacted. Ship them to the host's log service.
- **Backups:** Atlas continuous backup (point-in-time); bucket versioning on S3. Test a restore every quarter.
- **Monitoring:** alert on API health, 5xx rate, BullMQ failed jobs (also shown on the Overview page as "AI jobs failed in the last 30 days"), Redis memory and Atlas metrics.
- **Upgrades:** deploy the API and worker together, because they share `@cslp/server-core`. Schema changes are additive: new fields have defaults and indexes build in the background.
