---
'@logact-pub/opc-protocol': minor
---

feat(protocol): gateway 发现与 per-agent 模型配置

- `ParticipantKindSchema` 新增 `'gateway'`。
- 新增 `AgentModelConfigSchema`（`provider` / `modelId` / 可选 `apiKey`）及导出类型 `AgentModelConfig`。
- `RegisterParticipantRequestSchema` 新增可选 `model` 字段。
- `agent.spawn` 命令（`GatewaySpawnCommandSchema`）新增可选 `name` / `model`，并导出 `GatewaySpawnCommand` 类型。
- 新增 `ListParticipantsQuerySchema`：`GET /api/v1/participants` 支持 `?kind=` 过滤。

均为纯新增，向后兼容。
