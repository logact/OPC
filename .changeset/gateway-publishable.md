---
'@opc/agent-edge': minor
'@opc/agent-gateway': minor
'@opc-pub/agent-edge-app': minor
---

Publish OPC Agent Gateway packages to npm

- `@opc/agent-edge` and `@opc/agent-gateway` are now public packages with `publishConfig` pointing to npm.
- Introduce `@opc-pub/agent-edge-app` as the installable CLI (renamed from the private `@opc/agent-edge-app`).
- Add global `opc-gateway` binary that runs `opc-gateway start` to start the edge gateway.
