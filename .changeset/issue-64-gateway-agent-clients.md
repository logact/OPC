---
'@opc/server': minor
'@logact-pub/opc-sdk': minor
'@opc/api-client': minor
'@opc/database': patch
---

feat(server, sdk, api-client): gateway discovery + spawn payload forwarding

- `@opc/server`:
  - `GET /api/v1/participants` supports the `?kind=` filter and is now a public endpoint (matches the already-public register endpoint; enables mobile gateway discovery).
  - Registering an agent with `kind: 'agent'` + `gatewayId` forwards `name` and `model` into the `agent.spawn` command.
- `@logact-pub/opc-sdk`:
  - `listParticipants(kind?)` filters by participant kind.
  - `registerParticipant(...)` accepts an optional `model` argument.
- `@opc/api-client`:
  - `register(id, { name?, kind?, gatewayId?, model? })` options object; responses are runtime-validated with protocol Zod schemas.
  - `list({ kind? })` supports the kind filter.
- `@opc/database`: participant kind constants are derived from `@logact-pub/opc-protocol` (single source of truth).

All wire changes are backward-compatible additions.
