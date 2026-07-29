---
'@opc/api-client': patch
'@opc/mobile': minor
---

feat(mobile): Add Agent 页面使用 gateway 模型目录

- `@opc/api-client`：`participantsApi.update` 支持 `modelCatalog`；`get`/`update` 响应改为 protocol Zod schema 运行时解析；`GetParticipantResponse` / `UpdateParticipantRequest` / `UpdateParticipantResponse` / `Participant` 等类型改为 protocol 单一来源 re-export，并新增导出 `GatewayModelCatalog` / `ModelInfo` / `ProviderModels`。
- `@opc/mobile` AddAgentScreen：选中 gateway 带 `metadata.modelCatalog` 时，provider chips 与模型列表来自 catalog（模型点选，免手输）；无 catalog 时保持硬编码 provider + 自由文本 model id 的原行为。
