# 08 — Implementation Roadmap

Each module goes through the same loop: **responsibility → data model → contract (Zod + OpenAPI) → backend → admin UI → tests → workflow check → docs update.**

## Phase 0: Architecture baseline ✅ (this document set)

Exit: docs 01–08 accepted, open decisions in the README owned by named people.

## Phase 1: Foundation ✅ (2026-11-09)

| #       | Deliverable                                                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 ✅  | Monorepo scaffold: pnpm + Turborepo, `packages/config`, strict TS, Prettier. _(ESLint + Husky still to add.)_                                                                                                                  |
| 1.2 ✅  | `infrastructure/docker-compose.yml`: `mongodb-atlas-local` (vector search locally), Redis 7, SeaweedFS (S3), Mailpit. _(ClamAV arrives with uploads in Phase 2.)_                                                              |
| 1.3 ✅  | `apps/api` skeleton: config module (Zod-validated env), Pino logging, request ID, envelope + exception filter, throttler, Swagger at `/api/docs`, health checks                                                                |
| 1.4 ✅  | `packages/server-core`: Mongoose connection, tenant plugin, `TenantScope`, audit log service                                                                                                                                   |
| 1.5 ✅  | `packages/validation` + `shared-types` + Orval `api-client` + `contracts:check` CI step                                                                                                                                        |
| 1.6 ✅  | **Auth:** users, invitations, login, Argon2id, access/refresh cookies with rotation and reuse detection, CSRF, TOTP MFA, lockout, sessions                                                                                     |
| 1.7 ✅  | **RBAC:** permission catalogue, role bundles, role assignments, guards, `@ScopeFrom`, separation-of-duty checks                                                                                                                |
| 1.8 ✅  | **Academic structure:** institutions, faculties, departments, programmes, levels, semesters, curriculum versions (CRUD + archive + tree)                                                                                       |
| 1.9 ✅  | `apps/admin` shell: auth pages, MFA, layout with the full sidebar (unbuilt sections show "coming in phase N"), `packages/ui` primitives, design tokens, dark mode, TanStack Query provider                                     |
| 1.10 ✅ | Admin screens: Institutions, Faculties/Departments, Programmes, Levels, Semesters, Administrators (invite, assign role)                                                                                                        |
| 1.11 ✅ | Seed script (idempotent): Super Admin from env, YABATECH institution + First/Second semesters. No faculties, departments, programmes or levels: ND/HND levels belong to programmes, which an admin must enter, never invented. |
| 1.12 ✅ | CI (GitHub Actions): build, typecheck, unit + integration tests, contract check. _(Lint and Docker image build still to add.)_                                                                                                 |

**Exit criteria:** an invited Institution Admin with MFA can log in and manage only their institution's structure. Cross-institution access tests pass. The OpenAPI client is generated and used by admin.

## Phase 2: Courses, outlines, topics, sources ✅ (2026-11-09)

- ✅ Courses CRUD with the course-code uniqueness rule, draft by default, demo-data banner
- ✅ Topics tree: create, nest, drag-and-drop (`@dnd-kit`, mouse/touch/keyboard) plus Move up/down, Indent/Outdent buttons, fractional ordering
- ✅ Storage service (API-proxied upload with content sniffing, signed download), `mediaAssets`, malware scan interface (ClamAV optional, recorded as `skipped` when not configured)
- ✅ `apps/worker` + BullMQ queues; job records with progress, retries and status per document/outline
- ✅ Document ingest: extract (PDF, DOCX, TXT) → chunk → embed (when a provider is configured). Outline extraction with a review screen → approve → sync topics with diff preview
- ✅ Source library: upload, licence confirmation, approve for generation, passage inspector, reprocess, delete

**Exit (met):** the smoke test runs a real outline PDF through API → Redis → worker → SeaweedFS → MongoDB, and the Playwright suite creates the COM 001 demonstration course, reviews and approves its outline, syncs topics and reorders them.

**Still open from Phase 2:** OCR for scanned PDFs; department-level role scoping; a cross-institution "background jobs" admin screen (per-item job status exists).

## Phase 3: AI Content Studio, editor, versioning, review

### 3a ✅ (2026-11-09)

- ✅ Provider abstraction with task-key model routing (`AI_MODEL_*`), usage ledger, and a clearly labelled development provider (`AI_TEXT_PROVIDER=fake`, refused in production)
- ✅ `learningMaterials` / `contentVersions` / `contentReviews`; transitions; display status
- ✅ Generation of comprehensive notes, simplified notes and revision packs: retrieval over **approved** sources only (vector search, keyword fallback), structured output, server-side citation validation (unknown labels removed, unsupported "source-grounded" sections downgraded), editor document conversion with provenance markers
- ✅ TipTap editor: headings, lists, tables, code blocks, callouts, citations, provenance markers, debounced autosave with optimistic concurrency (412 on conflict), version history
- ✅ Submit / withdraw / fork; review queue and review dialog with checklist; separation of duties (author, editor or submitter can never approve)
- ✅ Batch generation across topics from the Studio
- Ingestion no longer fails when embedding fails (provider outage or no credits): passages stay usable via keyword retrieval with a visible warning

### 3b ✅ (2026-11-09)

- ✅ Quiz generation from **approved** notes only (multiple choice, true/false, fill-in-the-gap, short answer), server-side validity rules per type, exact + near-duplicate flagging (never auto-deleted)
- ✅ Question review with separation of duties; editing an approved question creates a new draft revision
- ✅ Quiz composition from approved questions, pinned to exact revisions; quiz drafts allow reorder/remove/settings only; quizzes follow the normal submit → review flow
- ✅ Editor AI assist (simplify, expand, beginners, examples, grammar, clarity, revision points): suggestion only, applied on accept
- ✅ AI usage & costs screen from the usage ledger; costs only from configured prices (`AI_PRICES_JSON`), never guessed; optional monthly budget per institution blocks new AI work when reached
- ✅ Deterministic clean-up of model output (leaked citation tags/provenance labels removed; outline numbering stripped)
- Verified against real OpenAI models (notes, revision packs, outline extraction, questions, editor assist) on throwaway databases

**Still open from Phase 3:** maths (KaTeX) and Mermaid diagram rendering in the editor; streaming for editor suggestions; embedding-based duplicate detection (token similarity is used today).

**Exit 3a (met):** in the Playwright suite a content manager generates notes for a topic from an approved source, edits them with autosave and submits them; the author cannot review their own work and the item appears in the review queue. Server tests cover approval by a second reviewer, forking and institution isolation.

## Phase 4: AI Video Studio (deferred: shown as "Coming soon" in the portal, 2026-11-09)

- 4a: `packages/video-templates` (themes, scenes), Player preview in admin, script generation + editor, TTS adapter, lexicon, alignment/captions, Remotion worker image, render flow, progress SSE, cancellation, review UI, scene regeneration, video cost tracking
- 4b (optional): avatar provider adapter (HeyGen or Synthesia)

**Exit:** an approved lesson becomes a reviewed, captioned 5–8 minute video, generated without leaving the portal. A scene and its pronunciation can be fixed without a full regeneration.

## Phase 5: Publishing, student API, analytics, hardening, deploy

### 5a ✅ (2026-11-09)

- ✅ `PublishingService` (the only code that changes what students see): publish, schedule (worker sweep every minute with a Redis lock; approval re-checked when due), cancel schedule, unpublish, rollback (pointer change to an earlier approved/published version), course and topic visibility, all-or-nothing bundles in a MongoDB transaction
- ✅ Append-only publication history; Publishing Centre (Ready / Scheduled / Published / History) with course/topic visibility shortcuts
- ✅ `PublishedContentService` + `/api/v1/student/courses`, `/courses/:id`, `/materials/:id`: visibility chain (institution active → course → topic and parent topic → material), published version only, explicit allow-list serialisers, quiz answers never sent, students scoped to their own institution, hidden content returns 404
- ✅ Preview-as-student (same serialiser) on every version
- Tests: visibility matrix, draft leakage, rollback, schedules, bundles, quiz-answer leakage, cross-institution isolation (service + HTTP + browser)

### 5b ✅ (2026-11-09)

- ✅ Email: SMTP mailer (Mailpit locally) with a console fallback, as one global module
- ✅ Student accounts: self-registration (institution slug, optional programme/level, optional email-domain allow-list); email verification required before sign-in; forgot/reset password for every account (each account type's password policy; resetting signs the user out everywhere). The same answer is given whether or not an email is registered, and these routes have tight rate limits.
- ✅ Learning API: enrolments, progress (only moves forward), quiz attempts graded server-side from the pinned question revisions (short answers without a match are left for review; official-assessment answers stay hidden), attempt history
- ✅ Admin: live Overview metrics and recent activity, Analytics (engagement, completion, quiz scores by course and material), Students (search, suspend/reactivate, which signs the student out at once)
- ✅ Hardening: admin CSP + HSTS, Docker images for api/worker/admin, [deployment guide](09-deployment.md)
- Tests: grading rules, learning/insights services, registration/verification/reset/suspension over HTTP, Playwright for Students, Analytics, Overview and forgot-password

### Next

- Student website and mobile app on top of `/api/v1/student/*` and `/auth/*`
- Phase 4 (AI video) when scheduled
- Choose a host, then IaC, CI deploy pipeline and monitoring

## Testing strategy

| Layer                                                                   | Tooling                                                              | Must cover (brief §23)                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                                                                    | Vitest/Jest                                                          | transition table, permission resolution, dedupe keys, citation validator, block converter, lexicon, caption builder, cost estimator                                                                                                                                                                                                                            |
| Integration (API + real Mongo + Redis via Testcontainers / atlas-local) | Jest + Supertest                                                     | auth (rotation, reuse detection, MFA, lockout), **institution isolation on every admin route** (a generated test iterates the route table), course-code uniqueness, upload validation, job creation + duplicate prevention, approval workflow + self-approval block, publish/schedule/rollback, **student visibility matrix** (every kind × every state → 404) |
| Worker                                                                  | Jest with mocked providers + in-memory BullMQ (real Redis container) | ingestion, generation happy path / schema-repair / failure, video flow with a stubbed renderer, cancellation, retries                                                                                                                                                                                                                                          |
| Contract                                                                | `contracts:check`                                                    | spec ↔ client in sync                                                                                                                                                                                                                                                                                                                                          |
| E2E                                                                     | Playwright against docker-compose                                    | login + MFA, create course → upload outline → generate → review → publish → visible via student API. Keyboard-only topic reordering.                                                                                                                                                                                                                           |
| Accessibility                                                           | axe in Playwright                                                    | every admin page with no serious violations                                                                                                                                                                                                                                                                                                                    |

All AI providers are mocked in CI. A nightly optional job runs a small live smoke suite against a capped test budget.

## Environments and deployment (default plan, pending the hosting decision)

| Env        | Purpose                                     | Data        |
| ---------- | ------------------------------------------- | ----------- |
| local      | docker-compose                              | seeded demo |
| preview    | per-PR admin deployment against staging API | staging     |
| staging    | full stack, mocked or capped providers      | synthetic   |
| production |                                             | real        |

- **Containers:** `api`, `worker-ai`, `worker-video` (Remotion/Chromium/FFmpeg image), `worker-scheduler`. `admin` and `web` on Vercel or as containers.
- **Data:** MongoDB Atlas (M10+ for transactions at scale and Vector Search on dedicated tiers), managed Redis with persistence (`noeviction` policy, which BullMQ requires), R2/S3 + CDN.
- **Secrets:** cloud secret manager, injected at runtime, never in images or the repo. `.env.example` documents every variable.
- **Observability:** Sentry (frontend + backend), OTel traces, Pino → log aggregation, queue dashboard (Bull Board, admin-only, behind Super Admin auth), alerts on job failure rate, queue age, provider error rate, budget at 80%.

## Admin UI map (wireframes follow in Phase 1.9)

```
Overview (dashboard)
Academic ▸ Institutions · Faculties & Departments · Programmes · Academic Levels · Semesters
Courses ▸ list → Course detail [Overview | Outline | Topics | Materials | Sources | Publishing | Activity]
Course Outlines (cross-course list of pending extractions/approvals)
AI Content Studio ▸ pick course/topic → choose outputs + options → job progress → open in editor
AI Video Studio ▸ pick approved lesson → configure → script editor + live preview → render → review
Quiz Management ▸ question bank · quizzes · duplicates
Content Reviews ▸ queue (filters: kind, course, age) → review screen
Publishing Centre ▸ approved-not-published · scheduled · published · history/rollback
Students · Analytics · AI Usage & Costs · Administrators · Settings (Super Admin: AI providers, budgets, security)
```

## Next step

Once the open decisions in the README are confirmed (or the defaults accepted), Phase 1.1–1.5 begins: monorepo scaffold, local infrastructure, API skeleton, and the contract pipeline.
