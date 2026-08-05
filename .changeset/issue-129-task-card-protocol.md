---
'@logact-pub/opc-protocol': minor
---

feat(protocol): chat 发起任务的任务卡片契约（issue #129）

- `CreateTaskRequestSchema` 新增可选 `originRoomId`：搭配 `assigneeId` 使用时，
  server 在创建即指派的同时，往该（发起聊天的）房间写一条任务卡片消息。
- `TaskMessageMetadataSchema` 的 `opcTask` 联合新增 `reference` variant
  （`{ kind: 'reference', taskId }`）：标识房间里的任务卡片消息，消费端据此
  渲染卡片并跳转任务详情页。

均为纯新增的可选字段 / union variant，向后兼容。注意：未升级的 gateway 无法
识别 `reference` 元数据，会把任务卡片消息当普通聊天消息处理——随本次发布
一并升级 `@opc/agent-gateway` 即可（gateway 已改为忽略所有非 assignment 的
`opcTask` 消息）。
