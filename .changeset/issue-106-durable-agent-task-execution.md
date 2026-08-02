---
'@logact-pub/opc-protocol': minor
'@logact-pub/opc-sdk': minor
'@opc/agent-edge': minor
'@opc/agent-gateway': minor
'@opc/server': minor
'@opc/database': minor
---

feat: keep assigned agent work attached to one durable task execution (issue #106)

- Persist one executable assignment message and task/thread claim per assignment.
- Route task-room replies back into the same live runtime thread and preserve task
  context on agent replies.
- Translate runtime waiting, resume, completion, and failure outcomes into ordered,
  idempotent task lifecycle callbacks through the owning gateway.
- Reject stale assignment callbacks and gateway attempts to impersonate agents they
  do not own.
- Recover callback outboxes after reconnect or restart, and fail orphaned executions
  instead of re-running them without their original model and tool context.

The protocol and SDK changes are backward-compatible additions; existing task
callers may omit the new assignment precondition and delegated actor header.
