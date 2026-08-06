---
'@opc/mqtt-client': minor
'@opc/api-client': minor
---

feat(mqtt-client, api-client): 已读回执与已读游标读取（issue #108 mobile 侧）

- `@opc/mqtt-client`：`OpcMqttClient` 新增 `publishReadReceipt(roomId, participantId, lastReadAt)`，向 `opc/rooms/{roomId}/reads` 上报已读回执；`ServerEvent` 联合类型新增 protocol 的 `read.updated` 事件；`topics.ts` 改为 re-export `@logact-pub/opc-protocol` 的 topic 约定（消除重复定义）。
- `@opc/api-client`：rooms API 新增 `readState(roomId)`（`GET /rooms/{id}/read-state`），响应经 `RoomReadStateResponseSchema` 运行时校验。

均为纯新增，向后兼容。
