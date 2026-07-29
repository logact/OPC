---
'@logact-pub/opc-protocol': minor
---

feat(protocol): Participant 增加 gatewayId，支持按 gateway 过滤 agent（issue #73）

- `ParticipantSchema` 新增可选字段 `gatewayId`（仅 `kind='agent'` 且注册时提供时有值），server 注册 agent 时持久化归属 gateway。
- `ListParticipantsQuerySchema` 新增可选查询参数 `gatewayId`，与 `kind` 过滤可组合。

均为纯新增可选字段，向后兼容（无破坏性变更）。
