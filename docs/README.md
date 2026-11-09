# CSLP — Computer Science Learning Platform

Architecture documentation for the shared platform: **Admin Portal**, **Student Website**, **Mobile App**, one **NestJS API**, one **MongoDB Atlas** database.

> Status (2026-11-09): Phases 1, 2, 3, 5a and 5b are implemented: admin portal, AI content, publishing, student accounts and learning API, analytics, and Docker images. Phase 4 (AI video) is marked "Coming soon". See [08-roadmap.md](08-roadmap.md) and [09-deployment.md](09-deployment.md).

| #   | Document                                                  | Covers                                                                                |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 01  | [Architecture](01-architecture.md)                        | System diagram, monorepo layout, runtime topology, key decisions (ADRs)               |
| 02  | [Database design](02-database-design.md)                  | Every collection, fields, references, indexes, tenancy rules                          |
| 03  | [Roles & permissions](03-roles-permissions.md)            | Permission catalogue, role matrix, institution scoping, separation of duties          |
| 04  | [API contracts](04-api-contracts.md)                      | Conventions, envelopes, errors, full endpoint catalogue, contract tooling             |
| 05  | [Content lifecycle & publishing](05-content-lifecycle.md) | State machines, versioning, review, publishing, rollback, student visibility          |
| 06  | [AI content pipeline](06-ai-content-pipeline.md)          | Outline extraction, RAG, structured generation, citations, editor AI actions, quizzes |
| 07  | [AI video pipeline](07-ai-video-pipeline.md)              | Script → scenes → TTS → captions → Remotion render → review                           |
| 08  | [Roadmap](08-roadmap.md)                                  | Phases, milestones, exit criteria, testing strategy, deployment                       |
| 09  | [Deployment & operations](09-deployment.md)               | Docker images, managed services, configuration, security baseline, operations         |

## The non-negotiables (from the brief)

1. One API, one database, one publishing service for admin, web and mobile.
2. Permissions and institution scoping are enforced **on the backend**, on every request.
3. AI output is **always a draft**. Nothing is published without human approval.
4. Published content is **immutable**. Edits create new versions. Rollback is a pointer change.
5. Course data for YABATECH is **never invented**. Demonstration courses are flagged `isDemoData`; the seed creates no academic structure beyond semesters.
6. No hardcoded model names in business logic. Providers and models are set in backend configuration.

## Open decisions for the product owner

These do not block Phase 1, but they must be settled before the phase listed.

| Decision                                             | Needed by             | Default if nothing is decided                                                                                                                              |
| ---------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting target (AWS vs. Render/Fly/Railway + Vercel) | Phase 1 (end)         | Containers on AWS (ECS Fargate) in `eu-west-1`, Atlas in `eu-west-1`. Latency to Lagos is about the same as `af-south-1`, and more services are available. |
| Object storage / CDN                                 | Phase 2               | Cloudflare R2 + Cloudflare CDN (no egress fees, which matters for video)                                                                                   |
| TTS provider                                         | Phase 4               | OpenAI TTS for v1, with ElevenLabs behind the same interface                                                                                               |
| Avatar provider (HeyGen / Synthesia)                 | Phase 4 (optional)    | Deferred. The interface is built, but no adapter ships in v1.                                                                                              |
| Remotion company licence                             | Phase 4               | Required if the operating company has more than 3 employees. Check this before production.                                                                 |
| Payments provider                                    | Student phase         | Paystack (NGN, cards, bank transfer, USSD)                                                                                                                 |
| Data-protection officer / NDPA 2023 registration     | Before student launch | Must be handled by the organisation                                                                                                                        |
