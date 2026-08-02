---
'@logact-pub/opc-protocol': minor
'@logact-pub/opc-sdk': minor
'@opc/server': minor
'@opc/database': minor
'@opc/api-client': minor
---

feat: add the first-class task system (issue #109)

- Adds protocol-owned task models, lifecycle commands, recommendation results,
  stable task errors, HTTP routes, and `task.event` room events.
- Adds task persistence, immutable assignment/result/transition/event history,
  idempotency receipts, serialized mutations, and one reusable room per task.
- Adds authorization-aware server workflows for draft creation, human-confirmed
  assignment, execution, review, terminal states, visibility, and deterministic
  candidate recommendations.
- Adds runtime-validated task APIs to both the public SDK and mobile API client.

All additions are backward compatible; existing consumers require no migration.
