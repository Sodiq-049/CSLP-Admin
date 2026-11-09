# 03 — Roles & Permissions

## 1. Model

```
User ──< RoleAssignment(role, institutionId | null, departmentIds[])
Role  = code-defined bundle of Permissions
Check = hasPermission(user, permission) AND inScope(user, targetInstitutionId, targetDepartmentId)
```

- Permissions are fine-grained strings (`resource.action`). Controllers declare them with `@RequirePermission(...)`. **Role names never appear in controllers.**
- Scope is resolved from the target resource, never trusted from the client. For example, `PATCH /admin/courses/:id` loads the course's `institutionId` and checks it against the user's assignments.
- A user can hold several assignments, for example Content Manager at institution A and Reviewer at institution B. Permissions are evaluated **per institution**.

## 2. Permission catalogue

| Area               | Permissions                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform           | `platform.settings.manage`, `platform.ai_providers.manage`, `platform.billing.manage`, `platform.analytics.view`, `platform.security.manage`                                                                   |
| Institutions       | `institution.create`, `institution.update`, `institution.archive`, `institution.view`                                                                                                                          |
| Users              | `admin_user.invite`, `admin_user.update`, `admin_user.suspend`, `role.assign.any`, `role.assign.institution_staff`, `student.view`, `student.manage`                                                           |
| Academic structure | `academic.view`, `academic.manage` (faculties, departments, programmes, levels, semesters, curricula)                                                                                                          |
| Courses            | `course.view`, `course.create`, `course.update`, `course.archive`, `course.publish`                                                                                                                            |
| Topics             | `topic.manage` (create, update, reorder, archive)                                                                                                                                                              |
| Outlines           | `outline.upload`, `outline.approve`                                                                                                                                                                            |
| Sources            | `source.upload`, `source.approve_for_generation`, `source.delete`                                                                                                                                              |
| Content            | `content.view`, `content.generate`, `content.edit`, `content.submit_review`, `content.review` (approve/reject/request changes), `content.publish`, `content.unpublish`, `content.rollback`, `content.schedule` |
| Quizzes            | `quiz.manage`, `question.review`, `question.mark_official`                                                                                                                                                     |
| Video              | `video.generate`, `video.edit`, `video.review`, `video.publish`                                                                                                                                                |
| AI ops             | `ai_jobs.view`, `ai_jobs.cancel`, `ai_usage.view`, `ai_budget.manage`                                                                                                                                          |
| Governance         | `audit.view`, `analytics.view`                                                                                                                                                                                 |

## 3. Role matrix

✅ = granted · 🏛 = only within assigned institution(s) · — = not granted

| Permission                                        | Super Admin |  Institution Admin   |    Content Manager    | Academic Reviewer |
| ------------------------------------------------- | :---------: | :------------------: | :-------------------: | :---------------: |
| platform.*                                        |     ✅      |          —           |           —           |         —         |
| institution.create / archive                      |     ✅      |          —           |           —           |         —         |
| institution.update / view                         |     ✅      |          🏛           |        view 🏛         |      view 🏛       |
| admin_user.invite / update / suspend              |     ✅      | 🏛 (staff roles only) |           —           |         —         |
| role.assign.any                                   |     ✅      |          —           |           —           |         —         |
| role.assign.institution_staff                     |     ✅      |   🏛 (CM, Reviewer)   |           —           |         —         |
| student.view                                      |     ✅      |          🏛           |           —           |         —         |
| student.manage                                    |     ✅      |          🏛           |           —           |         —         |
| academic.view                                     |     ✅      |          🏛           |           🏛           |         🏛         |
| academic.manage                                   |     ✅      |          🏛           |           —           |         —         |
| course.view                                       |     ✅      |          🏛           |           🏛           |         🏛         |
| course.create / update                            |     ✅      |          🏛           |           🏛           |         —         |
| course.archive                                    |     ✅      |          🏛           |           —           |         —         |
| course.publish                                    |     ✅      |          🏛           |           —           |         —         |
| topic.manage                                      |     ✅      |          🏛           |           🏛           |         —         |
| outline.upload                                    |     ✅      |          🏛           |           🏛           |         —         |
| outline.approve                                   |     ✅      |          🏛           |           —           |         🏛         |
| source.upload                                     |     ✅      |          🏛           |           🏛           |         —         |
| source.approve_for_generation                     |     ✅      |          🏛           |           —           |         🏛         |
| content.view                                      |     ✅      |          🏛           |           🏛           |         🏛         |
| content.generate / edit / submit_review           |     ✅      |          🏛           |           🏛           |         —         |
| content.review                                    |     ✅      |          🏛           |           —           |         🏛         |
| content.publish / unpublish / schedule / rollback |     ✅      |          🏛           |           —           |         —         |
| quiz.manage                                       |     ✅      |          🏛           |           🏛           |         —         |
| question.review                                   |     ✅      |          🏛           |           —           |         🏛         |
| question.mark_official                            |     ✅      |          🏛           |           —           |         🏛         |
| video.generate / edit                             |     ✅      |          🏛           |           🏛           |         —         |
| video.review                                      |     ✅      |          🏛           |           —           |         🏛         |
| video.publish                                     |     ✅      |          🏛           |           —           |         —         |
| ai_jobs.view                                      |     ✅      |          🏛           | 🏛 (own + institution) |         🏛         |
| ai_jobs.cancel                                    |     ✅      |          🏛           |     🏛 (own jobs)      |         —         |
| ai_usage.view                                     |     ✅      |          🏛           |           —           |         —         |
| ai_budget.manage                                  |     ✅      |  — (requests only)   |           —           |         —         |
| audit.view                                        |     ✅      |          🏛           |           —           |         —         |
| analytics.view                                    |     ✅      |          🏛           |           —           |         —         |

**Note:** the brief says Content Managers can "manage quizzes and videos" but does not say they can publish. In this design, **publishing belongs to Institution Admin and Super Admin only.** Reviewers approve. That gives a three-person chain: author → reviewer → publisher. If the institution is small, one Institution Admin can review and publish. They still cannot approve **their own** authored version (see below).

## 4. Enforcement layers

1. **AuthGuard:** valid access JWT with `aud=admin`, `accountType=admin`, active session, and MFA satisfied when the user's role requires it.
2. **PermissionsGuard:** the user has the permission in _at least one_ assignment (fast reject).
3. **Scope resolution:** a `@ScopeFrom('course', 'params.id')` decorator loads the target's `institutionId` / `departmentId` (cached per request). The guard checks that a matching assignment grants the permission **for that institution** and that, if the assignment has `departmentIds`, the department is among them.
4. **List endpoints:** the service receives a `TenantScope { institutionIds: ObjectId[] | 'all', departmentIds?: … }` built from assignments. A client-supplied `institutionId` filter is intersected with it, never trusted alone.
5. **Repository / Mongoose plugin:** queries on 🏛 models without `institutionId` throw (`TenantScopeViolation`) unless `crossTenant: true` is set by a Super Admin code path.
6. **Vector search:** `RetrievalService` always injects `institutionId` into `$vectorSearch.filter`.
7. **Student API:** a different guard (`aud=student`). It reaches content only through `PublishedContentQueryService`.

## 5. Separation of duties (enforced in services, not the UI)

| Rule                                                                                                                   | Where                   |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| A user cannot approve a version they authored or last edited (`submittedBy` / `updatedBy`)                             | `ReviewService.approve` |
| A user cannot grant a role higher than their own, or outside their institution                                         | `RoleAssignmentService` |
| The last active Super Admin cannot be suspended or demoted                                                             | `UsersService`          |
| Changes to roles, MFA reset and provider keys require re-authentication within the last 10 minutes (`auth_time` claim) | `RecentAuthGuard`       |
| Marking a question as an official assessment needs `question.mark_official` and is audit-logged                        | `QuestionService`       |

## 6. Admin authentication requirements

| Control                     | Admin                                                                                  | Student                         |
| --------------------------- | -------------------------------------------------------------------------------------- | ------------------------------- |
| Password policy             | 12+ characters, checked against a breached-password list (k-anonymity API, optional)   | 8+ characters                   |
| MFA (TOTP + recovery codes) | **Mandatory** for Super Admin and Institution Admin. Optional (encouraged) for others. | Optional                        |
| Access token TTL            | 10 minutes                                                                             | 15 minutes                      |
| Refresh token               | 12-hour absolute / 2-hour idle, rotating, reuse detection                              | 30 days, rotating               |
| Lockout                     | 5 failures → 15-minute lock + email alert                                              | 10 failures → progressive delay |
| Account creation            | Invitation only                                                                        | Self-signup                     |
| Login rate limit            | 5 / min / IP+email                                                                     | 10 / min                        |
| Session list + revoke       | Yes                                                                                    | Yes                             |
