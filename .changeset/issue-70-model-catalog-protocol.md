---
'@logact-pub/opc-protocol': minor
---

feat(protocol): gateway 运行时模型目录（modelCatalog）

- 新增 `ModelInfoSchema`（`id` / `name` / 可选 `reasoning` / `contextWindow` / `maxTokens`）、`ProviderModelsSchema`（`provider` + `models`）、`GatewayModelCatalogSchema`（`providers` + ISO `updatedAt`），并导出推导类型 `ModelInfo` / `ProviderModels` / `GatewayModelCatalog`。
- `UpdateParticipantRequestSchema` 新增可选 `modelCatalog` 字段：gateway 启动时上报 pi-ai 内建模型目录，server 持久化到 participant 的 `metadata.modelCatalog`，供 mobile Add Agent 页面动态渲染 provider/model 选项。

均为纯新增，向后兼容。
