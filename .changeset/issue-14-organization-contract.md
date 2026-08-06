---
'@logact-pub/opc-protocol': minor
'@logact-pub/opc-sdk': minor
'@opc/server': minor
'@opc/database': minor
'@opc/api-client': minor
---

feat: add the single-organization contract and persistence foundation (issue #14)

- Adds protocol-owned Organization, Department, Position, Responsibility,
  CapabilityGrant/Scope, StaffProfile, and StaffAssignment schemas and types.
- Adds authenticated organization, hierarchy, position, staff, and assignment
  HTTP routes with structured stable error codes.
- Adds database migration/backfill. Existing humans and agents receive staff
  profiles, gateways are excluded, and the earliest human by `created_at, id`
  becomes the immutable Owner.
- Adds SDK and API-client consumers; API-client responses are runtime-validated
  with protocol Zod schemas.

This is additive and requires no consumer code migration. Before rollback,
export organization data if it must be retained; rollback may drop the new
organization tables but does not modify existing participant/room/message data.
