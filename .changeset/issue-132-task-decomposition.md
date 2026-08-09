---
'@logact-pub/opc-protocol': minor
'@logact-pub/opc-sdk': minor
'@opc/database': minor
'@opc/server': minor
'@opc/mobile': minor
---

feat: decompose tasks into independently assigned subtasks with derived parent progress (issue #132)

- The protocol adds immutable `parentTaskId` links, server-derived direct-child progress, parent/child detail projections, decomposition request/response schemas, lifecycle audit events, and `POST /api/v1/tasks/:id/decompose`.
- A task creator or current assignee—including a delegated agent—can create or batch-create subtasks, assign them independently, and receive a separate task room for each assignment. Nesting is capped at two levels, so cycles cannot be constructed.
- Parent completion is automatic once every direct child is completed; parent cancellation or failure cascades to open descendants. Existing task responses remain parseable because the new parent/progress/detail fields have compatibility defaults.
