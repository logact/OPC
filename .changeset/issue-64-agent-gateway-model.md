---
'@opc/agent-gateway': minor
'@opc-pub/agent-edge-app': minor
---

feat(agent-gateway): per-agent model config from spawn command

- `AgentGateway` builds the agent model from `agent.spawn`'s `model` field when present (priority: command model > `modelOptions` > `EDGE_MODEL_*` env); injected `agentFactory` path unchanged.
- The edge app self-registers with `kind: 'gateway'`, so gateways are discoverable via `GET /api/v1/participants?kind=gateway`.
