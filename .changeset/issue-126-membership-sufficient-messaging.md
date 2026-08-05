---
'@opc/server': minor
---

Make room membership sufficient for messaging (issue #126).

Semantic change, no wire-protocol changes: `message.read` / `message.send` no
longer require an active position grant. In `evaluate()`
(`apps/server/src/authorization.ts`), when the action is `message.read` or
`message.send` and the resource is a room/message, a room member is now
allowed immediately (the decision is still recorded in the authorization
audit). Non-members stay denied (`room membership is required for messaging`).
RBAC evaluation still governs all other capabilities.

Consequences:
- Any non-owner room member (human or agent) can now read room history and
  send messages without being granted `message.*` capabilities via a position.
- The gateway delegated history-read model is simplified: an owned agent
  being a room member is enough for the gateway to pull that room's history.
- Existing `message.*` capability grants in positions become no-ops for
  messaging decisions and can be cleaned up later; read-only/announcement
  rooms, if ever needed, should be a room-level attribute instead.
