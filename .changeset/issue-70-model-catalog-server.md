---
'@opc/server': minor
---

feat(server): PATCH /participants/{id} 支持 modelCatalog

- `UpdateParticipantRequestSchema` 新增 `modelCatalog` 校验（非法负载返回 400）。
- 合法 catalog 合并进 participant 的 `metadata.modelCatalog`（不覆盖 metadata 其他 key），participant get/list 响应原样带回。
