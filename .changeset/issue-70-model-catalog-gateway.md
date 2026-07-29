---
'@opc/agent-gateway': minor
'@opc/agent-edge': patch
---

feat(agent-gateway): 启动时上报模型目录

- 新增 `buildModelCatalog(models?)`：pi-ai 内建模型目录 → `GatewayModelCatalog` 的纯映射（按 provider 分组，映射 id/name/reasoning/contextWindow/maxTokens，updatedAt 取当前 ISO 时间），默认使用 `builtinModels()`。
- `AgentGateway.start()` 在 MQTT 建连后将目录 PATCH 到 `API_ROUTES.participant(gatewayId)`（Bearer 为 gateway token）；失败只告警，不阻塞启动。
- `@opc/agent-edge` 的 model 模块 re-export `builtinModels`，供 gateway 作为默认目录来源。
