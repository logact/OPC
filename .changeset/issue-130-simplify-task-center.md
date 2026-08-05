---
'@logact-pub/opc-protocol': major
---

feat(protocol)!: simplify task center (issue #130) — drop department binding, reviewer/collaborator roles, recommendation, and the review status

Breaking changes:
- `TaskSchema` no longer carries `departmentId`, `target`, `requiredSkillTags`, `reviewerId`, `collaboratorIds`; `TaskAssignmentSchema` no longer carries `reviewerId` / `collaboratorIds`.
- `TaskStatusSchema` drops `review`; `submit` now transitions `in_progress → completed` directly.
- Removed schemas and derived types: `TaskTargetSchema`/`TaskTarget`, `TaskAvailabilitySchema`/`TaskAvailability`, `TaskRecommendationSchema`/`TaskRecommendation`, `TaskRecommendationReasonSchema`/`TaskRecommendationReason`, `RecommendTaskResponseSchema`/`RecommendTaskResponse`, `ApproveTaskRequestSchema`/`ApproveTaskRequest`, `RejectTaskRequestSchema`/`RejectTaskRequest`.
- Removed routes from `API_ROUTES`: `taskRecommendations`, `taskApprove`, `taskReject` (`POST /api/v1/tasks/:id/recommendations|approve|reject`).
- Changed request schemas: `CreateTaskRequestSchema` is now `{ title, description?, assigneeId? }` (optional `assigneeId` creates the task directly in `assigned` status); `AssignTaskRequestSchema` is now `{ assigneeId, reason?, idempotencyKey }`; `UpdateTaskRequestSchema` only accepts `title` / `description`; `ListTasksQuerySchema` drops `departmentId` / `reviewerId`.
- `CapabilityNameSchema` drops the department-scoped task capabilities `task.create`, `task.read`, `task.manage`, `task.assign`, `task.review`; `AuthorizationResourceSchema` drops the `task` variant. Task authorization is now role-based (creator / current assignee / task-room member), enforced by the server instead of position capability grants.
- `TaskErrorCodeSchema` drops `invalid_task_target`, `invalid_task_roles`, `task_candidate_ineligible`; adds `forbidden` for role-based authorization failures.

Consumer migration:
- Create tasks with `{ title, description?, assigneeId? }`; assign or reassign via `POST /tasks/:id/assignments` with `{ assigneeId, reason?, idempotencyKey }` — no department, target, skill tags, reviewer, or collaborators.
- Replace the recommend → confirm flow with direct assignment; replace the approve/reject review flow with `submit` (completes the task immediately).
- Server keeps the three removed routes as **410 Gone** shims for one release; the shims are removed in the next major.
- Compatibility window: Zod object schemas keep stripping unknown keys, so old clients sending `departmentId` / `target` / `requiredSkillTags` / `reviewerId` / `collaboratorIds` still validate; `TaskEventKindSchema` keeps deprecated `task.approved` / `task.rejected` parseable for immutable history (never emitted again); `AuthorizationResourceTypeSchema` keeps `'task'` for historical audit rows. These compat shims are removed in the next major.
- Database migration rewrites existing `status='review'` rows to `'completed'` (irreversible — back up first) and drops the removed columns.
