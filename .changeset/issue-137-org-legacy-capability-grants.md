---
'@opc/server': patch
---

fix(server): keep organization endpoints schema-valid when legacy capability grants exist in the DB (issue #137)

#130 removed the `task.*` capabilities from the closed `CapabilityNameSchema` enum but shipped no data migration for `positions.capability_grants` (JSONB). Positions created before #130 still carried `task.*` grants, so `GET /api/v1/organization/tree` (and `/organization/staff`, `/organization/positions`) emitted capability names the current protocol schemas reject — the mobile api-client Zod parse threw and the org page showed an error for every user.

- Migration `0012_scrub_legacy_capability_grants` strips capability names outside the current catalog from `positions.capability_grants` (authorization semantics unchanged: unknown capabilities never matched any action).
- The organization repository now also filters out-of-catalog grants at read time (`sanitizeCapabilityGrants`), so responses stay schema-conformant even on databases that have not run the migration yet.

No protocol changes; consumers need no migration.
