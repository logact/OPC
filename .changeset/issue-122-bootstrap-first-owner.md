---
'@opc/server': major
---

Seed the first org owner from env at startup (issue #122) and close the unauthenticated first-human registration by default.

New behavior:
- `OPC_BOOTSTRAP_OWNER_ID` + `OPC_BOOTSTRAP_OWNER_PASSWORD`: before listening, the server seeds the first owner through the same code path as the registration route (`participantRepo.register` + `organizationRepo.reconcileParticipant`). Both vars must be set together — setting only one fails startup. Strictly idempotent: once an owner exists the vars are ignored (with a warning nudging operators to remove them); env never resets an existing owner's password.
- If neither var is set and no owner exists, the server still starts but logs a loud warning.

Breaking changes:
- Unauthenticated `POST /api/v1/participants` (first-human "open door" bootstrap) is now rejected with 401 unless `OPC_ALLOW_OPEN_BOOTSTRAP=true` is set.

Migration:
- Preferred: set `OPC_BOOTSTRAP_OWNER_ID` / `OPC_BOOTSTRAP_OWNER_PASSWORD` in your deployment env (docker-compose files pass them through); remove them after the owner exists.
- To keep the legacy open-door behavior (dev/e2e only), set `OPC_ALLOW_OPEN_BOOTSTRAP=true`.
- Gateway self-registration is unaffected in code but was already non-functional against the auth model; pre-register gateways with owner credentials and pin `EDGE_GATEWAY_TOKEN` instead.
