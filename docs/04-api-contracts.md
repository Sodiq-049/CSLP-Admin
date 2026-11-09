# 04 — Shared API Contracts

## 1. Contract pipeline

```
packages/validation (Zod schemas)
   │  imported by
   ├─▶ apps/api controllers (nestjs-zod: validation + Swagger metadata)
   │       └─▶ /api/v1/openapi.json  (generated at build, committed to docs/openapi.json)
   │                 └─▶ Orval ─▶ packages/api-client (fetchers + TanStack Query hooks)
   │                                   └─▶ apps/admin, apps/web, apps/mobile
   └─▶ apps/admin & apps/mobile forms (React Hook Form zodResolver)
```

CI step `contracts:check` regenerates the spec and client. It fails if there is any uncommitted difference, so frontends cannot drift from the API.

## 2. Conventions

| Topic               | Rule                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base path           | `/api/v1`. Breaking changes → `/api/v2`, with both served during the deprecation window.                                                                                      |
| Namespaces          | `/auth/*` (shared) · `/admin/*` (aud=admin) · `/student/*` (aud=student, web + mobile) · `/public/*` (no auth: catalogue, health) · `/webhooks/*` (signature-verified)        |
| Naming              | Plural nouns, kebab-case paths, camelCase JSON. State changes use **action sub-resources** (`POST …/submit-review`), not PATCHing the status field.                           |
| IDs                 | 24-hex ObjectId strings. Public student URLs may use slugs.                                                                                                                   |
| Dates               | ISO-8601 UTC strings.                                                                                                                                                         |
| Auth (browser)      | httpOnly, `Secure`, `SameSite=Lax` cookies `cslp_at` (path `/api`) and `cslp_rt` (path `/api/v1/auth/refresh`). CSRF: double-submit token `X-CSRF-Token` on non-GET requests. |
| Auth (mobile)       | `Authorization: Bearer <access>`. Refresh token stored in SecureStore and sent in the body to `/auth/refresh`.                                                                |
| Concurrency         | `ETag` on editable resources. `If-Match` is required on `PATCH` of drafts. Mismatch → `412`.                                                                                  |
| Idempotency         | `Idempotency-Key` header accepted (required for job-creating POSTs). Stored for 24 hours, keyed by user + route + key. A replay returns the original response.                |
| Pagination          | Admin: `?page=1&pageSize=25` (max 100). Student/mobile feeds: `?cursor=…&limit=20`.                                                                                           |
| Filtering / sorting | `?filter[status]=in_review&filter[courseId]=…&sort=-updatedAt&q=search`                                                                                                       |
| Rate limits         | `429` with `Retry-After`. Global per-IP plus a per-user budget. Stricter for auth and AI generation endpoints.                                                                |

### Response envelopes

```jsonc
// 2xx single
{ "data": { ... }, "meta": { "requestId": "req_01J..." } }

// 2xx list
{ "data": [ ... ], "meta": { "requestId": "...", "page": 1, "pageSize": 25, "total": 132 } }
// cursor variant
{ "data": [ ... ], "meta": { "requestId": "...", "nextCursor": "eyJ..." } }

// 202 job accepted
{ "data": { "jobId": "...", "status": "queued", "deduplicated": false }, "meta": { ... } }

// error (all 4xx/5xx)
{ "error": { "code": "CONTENT_NOT_APPROVED", "message": "Only approved versions can be published.",
             "details": [ { "path": "versionId", "issue": "review_status=in_review" } ],
             "requestId": "req_01J..." } }
```

### Error codes (stable, machine-readable)

`VALIDATION_FAILED` 400 · `UNAUTHENTICATED` 401 · `MFA_REQUIRED` 401 · `RECENT_AUTH_REQUIRED` 401 · `FORBIDDEN` 403 · `OUT_OF_SCOPE` 403 (returned as 404 for student routes) · `NOT_FOUND` 404 · `CONFLICT` 409 · `DUPLICATE_COURSE_CODE` 409 · `DUPLICATE_JOB` 409 (with existing `jobId`) · `VERSION_FROZEN` 409 · `INVALID_TRANSITION` 409 · `SELF_APPROVAL_FORBIDDEN` 403 · `CONTENT_NOT_APPROVED` 409 · `PRECONDITION_FAILED` 412 · `UNSUPPORTED_FILE` 415 · `FILE_TOO_LARGE` 413 · `BUDGET_EXCEEDED` 402 · `RATE_LIMITED` 429 · `PROVIDER_UNAVAILABLE` 503 · `INTERNAL` 500 (never leaks stack traces).

## 3. Endpoint catalogue

`P:` = required permission. All `/admin` routes are institution-scoped (doc 03 §4) unless marked 🌐.

### 3.1 Auth (`/auth`)

| Method     | Path                                                                     | Purpose                                                                 |
| ---------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| POST       | `/auth/login`                                                            | email + password → sets cookies, or returns `{ mfaRequired, mfaToken }` |
| POST       | `/auth/mfa/verify`                                                       | TOTP or recovery code → completes login                                 |
| POST       | `/auth/refresh`                                                          | rotate refresh token                                                    |
| POST       | `/auth/logout`                                                           | revoke current session                                                  |
| GET        | `/auth/me`                                                               | user, assignments, effective permissions per institution                |
| GET/DELETE | `/auth/sessions`, `/auth/sessions/:id`                                   | list / revoke own sessions                                              |
| POST       | `/auth/mfa/enrol`, `/auth/mfa/confirm`, `/auth/mfa/disable`              | TOTP setup (recent auth required)                                       |
| POST       | `/auth/invitations/:token/accept`                                        | admin sets password from invite                                         |
| POST       | `/auth/password/forgot`, `/auth/password/reset`, `/auth/password/change` |                                                                         |
| POST       | `/auth/register`                                                         | **students only**                                                       |

### 3.2 Institutions & academic structure (`/admin`)

| Method                   | Path                                                                                     | P                                             |
| ------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| GET / POST               | `/institutions` 🌐                                                                       | `institution.view` / `institution.create`     |
| GET / PATCH              | `/institutions/:id`                                                                      | `institution.view` / `institution.update`     |
| POST                     | `/institutions/:id/archive`                                                              | `institution.archive`                         |
| GET / POST               | `/institutions/:institutionId/faculties`                                                 | `academic.view` / `academic.manage`           |
| GET / POST               | `/institutions/:institutionId/departments`                                               | 〃                                            |
| GET / POST               | `/institutions/:institutionId/programmes`                                                | 〃                                            |
| GET / POST               | `/programmes/:programmeId/levels`                                                        | 〃                                            |
| GET / POST               | `/institutions/:institutionId/semesters`                                                 | 〃                                            |
| GET / POST               | `/institutions/:institutionId/curriculum-versions`                                       | 〃                                            |
| PATCH / POST `…/archive` | `/faculties/:id`, `/departments/:id`, `/programmes/:id`, `/levels/:id`, `/semesters/:id` | `academic.manage`                             |
| GET                      | `/institutions/:institutionId/academic-tree`                                             | `academic.view` (whole hierarchy for pickers) |

### 3.3 Courses, outlines, topics

| Method      | Path                        | P                                | Notes                                                                                                                |
| ----------- | --------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET         | `/courses`                  | `course.view`                    | filters: institution, department, programme, level, semester, status, q                                              |
| POST        | `/courses`                  | `course.create`                  | always created as draft. `409 DUPLICATE_COURSE_CODE`                                                                 |
| GET / PATCH | `/courses/:id`              | `course.view` / `course.update`  | PATCH needs `If-Match`                                                                                               |
| POST        | `/courses/:id/archive`      | `course.archive`                 |                                                                                                                      |
| GET         | `/courses/:id/outlines`     | `course.view`                    | version list                                                                                                         |
| POST        | `/courses/:id/outlines`     | `outline.upload`                 | `multipart` (file) **or** JSON `{ origin: 'manual'\|'paste', text \| structure }` → 201 outline + 202 extraction job |
| GET / PATCH | `/outlines/:id`             | `course.view` / `outline.upload` | edit `structure` while draft                                                                                         |
| POST        | `/outlines/:id/approve`     | `outline.approve`                | sets `course.activeOutlineId`                                                                                        |
| POST        | `/outlines/:id/sync-topics` | `topic.manage`                   | returns a diff preview. `?apply=true` applies it                                                                     |
| GET         | `/courses/:id/topics`       | `course.view`                    | tree with material status summary                                                                                    |
| POST        | `/courses/:id/topics`       | `topic.manage`                   |                                                                                                                      |
| PATCH       | `/topics/:id`               | `topic.manage`                   |                                                                                                                      |
| POST        | `/topics/:id/move`          | `topic.manage`                   | `{ parentTopicId?, beforeId?, afterId? }` (drag-and-drop **and** keyboard move)                                      |
| POST        | `/topics/:id/archive`       | `topic.manage`                   |                                                                                                                      |

### 3.4 Source documents

| Method | Path                                           | P                                                                                        |
| ------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| POST   | `/source-documents/upload-url`                 | `source.upload`. Returns a presigned PUT URL + `uploadId` (direct-to-storage, max 50 MB) |
| POST   | `/source-documents`                            | `source.upload`. `{ uploadId, title, category, courseId?, licence }` → starts ingest job |
| GET    | `/source-documents` · `/source-documents/:id`  | `content.view`                                                                           |
| GET    | `/source-documents/:id/chunks`                 | `content.view` (inspect extraction)                                                      |
| POST   | `/source-documents/:id/approve-for-generation` | `source.approve_for_generation`                                                          |
| DELETE | `/source-documents/:id`                        | `source.delete` (blocked if cited by approved content)                                   |

### 3.5 Learning materials, versions, review (the "lesson" endpoints in the brief)

The brief's `/lessons/:id/*` examples generalise to **materials** (notes, revision packs, quizzes, videos, resources share one lifecycle). `lesson` is the UI name for `notes_*` materials.

| Method | Path                                  | P                       | Notes                                                                                                                                                                                                                 |
| ------ | ------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/topics/:id/materials`               | `content.view`          |                                                                                                                                                                                                                       |
| POST   | `/topics/:id/materials`               | `content.edit`          | create an empty manual draft                                                                                                                                                                                          |
| POST   | `/topics/:id/generate-content`        | `content.generate`      | `{ kinds: ['notes_comprehensive','revision_pack','quiz'], options }` → 202 `{ batchId, jobs[] }`                                                                                                                      |
| POST   | `/courses/:id/generate-content`       | `content.generate`      | batch: `{ topicIds[] \| 'all', kinds, options }`                                                                                                                                                                      |
| GET    | `/materials/:id`                      | `content.view`          | material + version summaries                                                                                                                                                                                          |
| GET    | `/materials/:id/versions`             | `content.view`          | history                                                                                                                                                                                                               |
| GET    | `/versions/:id`                       | `content.view`          | full body + provenance                                                                                                                                                                                                |
| PATCH  | `/versions/:id`                       | `content.edit`          | draft only (`409 VERSION_FROZEN` otherwise). Autosave: `{ body, autosaveRev }` + `If-Match`                                                                                                                           |
| POST   | `/versions/:id/fork`                  | `content.edit`          | new draft from any version (how published content gets edited)                                                                                                                                                        |
| GET    | `/versions/:id/diff?against=:otherId` | `content.view`          |                                                                                                                                                                                                                       |
| GET    | `/versions/:id/checkpoints`           | `content.view`          |                                                                                                                                                                                                                       |
| POST   | `/versions/:id/ai-actions`            | `content.generate`      | `{ action: 'simplify'\|'expand'\|'rewrite_beginner'\|'add_examples'\|'code_example'\|'grammar'\|'clarity'\|'revision_points', selection: {from,to}, text }` → streamed suggestion (SSE). Never applied automatically. |
| POST   | `/versions/:id/submit-review`         | `content.submit_review` | freezes the version                                                                                                                                                                                                   |
| POST   | `/versions/:id/withdraw`              | `content.submit_review` | in_review → draft (author only, before a decision)                                                                                                                                                                    |
| POST   | `/versions/:id/reviews`               | `content.review`        | `{ decision, checklist, comments[] }`. Approve → `409/403` if self-authored                                                                                                                                           |
| GET    | `/reviews/queue`                      | `content.review`        | pending items across kinds, filterable                                                                                                                                                                                |
| GET    | `/versions/:id/preview-as-student`    | `content.view`          | renders through the **same** serializer the student API uses                                                                                                                                                          |

### 3.6 Quizzes & questions

| Method       | Path                                            | P                                                                       |
| ------------ | ----------------------------------------------- | ----------------------------------------------------------------------- |
| POST         | `/versions/:lessonVersionId/generate-questions` | `quiz.manage` → 202 job. Lesson version must be approved.               |
| GET          | `/questions`                                    | `content.view` (filters: course, topic, status, type, difficulty)       |
| POST / PATCH | `/questions`, `/questions/:id`                  | `quiz.manage` (PATCH on approved → new revision)                        |
| POST         | `/questions/:id/review`                         | `question.review`                                                       |
| POST         | `/questions/:id/mark-official`                  | `question.mark_official`                                                |
| GET          | `/questions/:id/duplicates`                     | `content.view`                                                          |
| POST         | `/materials/:quizMaterialId/versions`           | `quiz.manage` — compose a quiz version from approved question revisions |

### 3.7 Video studio

| Method             | Path                                                   | P                | Notes                                                                                                             |
| ------------------ | ------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| GET                | `/video/voices` · `/video/themes` · `/video/avatars`   | `video.generate` | from provider adapters                                                                                            |
| POST               | `/videos/generate`                                     | `video.generate` | `{ lessonVersionId, config }` → creates a video material/version + 202 flow job. Lesson version must be approved. |
| GET                | `/video-jobs/:id`                                      | `ai_jobs.view`   | stage-level progress                                                                                              |
| GET                | `/video-jobs/:id/events`                               | `ai_jobs.view`   | SSE progress stream                                                                                               |
| POST               | `/video-jobs/:id/cancel`                               | `ai_jobs.cancel` |                                                                                                                   |
| PATCH              | `/versions/:videoVersionId/script`                     | `video.edit`     | edit scene text/slides (draft only)                                                                               |
| POST               | `/versions/:videoVersionId/scenes/:sceneId/regenerate` | `video.edit`     | `{ parts: ['narration','visuals'] }`                                                                              |
| POST               | `/versions/:videoVersionId/render`                     | `video.edit`     | re-render after edits (cached scenes reused)                                                                      |
| GET                | `/versions/:videoVersionId/playback`                   | `content.view`   | signed URLs: mp4, captions VTT, poster                                                                            |
| GET / POST / PATCH | `/pronunciations`                                      | `video.edit`     | lexicon                                                                                                           |

Video approval uses the shared `/versions/:id/reviews`. `/videos/:id/approve` from the brief maps to it.

### 3.8 Publishing

| Method | Path                                  | P                                              | Notes                                                                                                            |
| ------ | ------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| POST   | `/materials/:id/publish`              | `content.publish` (`video.publish` for videos) | `{ versionId }`. Version must be approved and belong to the material.                                            |
| POST   | `/materials/:id/schedule`             | `content.schedule`                             | `{ versionId, publishAt }`                                                                                       |
| POST   | `/materials/:id/unpublish`            | `content.unpublish`                            | `{ reason }`                                                                                                     |
| POST   | `/materials/:id/rollback`             | `content.rollback`                             | `{ toVersionId, reason }` (must be previously approved)                                                          |
| POST   | `/courses/:id/publish` · `/unpublish` | `course.publish`                               | the course must be visible for any child content to show                                                         |
| POST   | `/topics/:id/publish` · `/unpublish`  | `content.publish`                              |                                                                                                                  |
| POST   | `/publish-bundles`                    | `content.publish`                              | `{ items: [{ materialId, versionId }], publishCourse?, publishTopics? }`, applied atomically (Mongo transaction) |
| GET    | `/publishing/overview`                | `content.view`                                 | approved-but-unpublished, scheduled, recently published                                                          |
| GET    | `/publication-events`                 | `content.view`                                 | audit of publishing actions                                                                                      |

`/content/:id/publish` from the brief maps to `/materials/:id/publish`.

### 3.9 Jobs, usage, analytics, governance

| Method             | Path                                                                         | P                                                                                         |
| ------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| GET                | `/ai-jobs` · `/ai-jobs/:id`                                                  | `ai_jobs.view`                                                                            |
| POST               | `/ai-jobs/:id/retry` · `/cancel`                                             | `ai_jobs.cancel`                                                                          |
| GET                | `/ai-usage/summary?from&to&groupBy=provider\|model\|capability\|institution` | `ai_usage.view`                                                                           |
| GET / PUT          | `/ai-budgets/:institutionId`                                                 | `ai_usage.view` / `ai_budget.manage`                                                      |
| GET                | `/dashboard/overview`                                                        | `content.view` (counts are scoped automatically)                                          |
| GET                | `/analytics/engagement?courseId&from&to`                                     | `analytics.view`                                                                          |
| GET                | `/students` · `/students/:id`                                                | `student.view`                                                                            |
| GET / POST / PATCH | `/admin-users`, `/admin-users/:id`, `/admin-users/:id/roles`                 | `admin_user.*`, `role.assign.*`                                                           |
| GET                | `/audit-logs`                                                                | `audit.view`                                                                              |
| GET / PUT          | `/settings/:key` 🌐                                                          | `platform.settings.manage` (AI provider keys: write-only, `platform.ai_providers.manage`) |
| GET                | `/notifications` · POST `/notifications/:id/read`                            | any admin                                                                                 |

### 3.10 Student API (`/student`): contract only, built in a later prompt

Everything here reads through `PublishedContentQueryService` (doc 05 §7).

| Method     | Path                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| GET        | `/student/catalog/institutions/:slug/programmes`                                                                                      |
| GET        | `/student/courses?programmeId&levelId&semesterId`                                                                                     |
| GET        | `/student/courses/:courseId` (published topics + published material summaries)                                                        |
| GET        | `/student/topics/:topicId/materials`                                                                                                  |
| GET        | `/student/materials/:materialId` (published version only: `renderedHtml`, `doc`, revision pack, quiz without answers, video playback) |
| POST       | `/student/quizzes/:materialId/attempts` · `/attempts/:id/submit` (graded server-side)                                                 |
| GET / PUT  | `/student/progress/...`                                                                                                               |
| POST       | `/student/enrolments`                                                                                                                 |
| GET / POST | `/student/ai/conversations`, `/student/ai/conversations/:id/messages` (RAG over published content + approved sources only)            |

## 4. Example: course create

```http
POST /api/v1/admin/courses
Idempotency-Key: 6d1f…
X-CSRF-Token: …
Content-Type: application/json

{ "institutionId": "6730…a1", "facultyId": "…", "departmentId": "…", "programmeId": "…",
  "levelId": "…", "semesterId": "…", "code": "COM 001", "title": "Introduction to Computer Science",
  "creditUnits": 3, "description": "…", "objectives": [{ "text": "…" }], "prerequisites": [], "references": [] }
```

```http
201 Created
ETag: "v0"
{ "data": { "id": "6730…ff", "code": "COM 001", "codeNormalized": "COM001",
            "status": { "review": "draft", "publication": "unpublished" }, "isDemoData": false, … },
  "meta": { "requestId": "req_01JC…" } }
```

The Zod source of truth (in `packages/validation/src/courses.ts`):

```ts
export const CourseCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(20)
  .regex(/^[A-Za-z]{2,6}\s?\d{3}[A-Za-z]?$/, 'Expected a code like "COM 101"');
export const CreateCourseSchema = z.object({
  institutionId: ObjectIdSchema,
  facultyId: ObjectIdSchema,
  departmentId: ObjectIdSchema,
  programmeId: ObjectIdSchema,
  levelId: ObjectIdSchema,
  semesterId: ObjectIdSchema,
  curriculumVersionId: ObjectIdSchema.optional(),
  code: CourseCodeSchema,
  title: z.string().trim().min(3).max(200),
  creditUnits: z.number().int().min(0).max(30),
  description: z.string().max(5000).default(''),
  objectives: z
    .array(z.object({ text: z.string().min(3).max(500) }))
    .max(30)
    .default([]),
  prerequisites: z.array(PrerequisiteSchema).max(20).default([]),
  references: z.array(ReferenceSchema).max(50).default([]),
});
```

The code regex is a **loose** guard and can be overridden per institution through settings (`academic.courseCodePattern`), because formats vary between institutions.
