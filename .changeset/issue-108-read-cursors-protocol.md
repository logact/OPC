---
'@logact-pub/opc-protocol': minor
'@logact-pub/opc-sdk': minor
'@opc/server': minor
'@opc/agent-gateway': minor
---

feat(protocol, server, sdk, agent-gateway): 消息已读/未读状态（issue #108）

- `@logact-pub/opc-protocol`：
  - `MQTT_TOPICS` 新增 `participantReads(participantId, roomId)`（`opc/participants/{participantId}/rooms/{roomId}/reads`）与 `participantReadsFilter`（`opc/participants/+/rooms/+/reads`），并新增 `parseParticipantReadsTopic`；`parseRoomTopic` 支持 `reads` 方向（携带 `participantId`）。与 actor-addressed uplink 同一约定：发送者由 topic 中的 participantId 绑定。
  - 新增 `RoomReadsPayloadSchema`（`{ from?, lastReadAt }`：`from` 为可选兼容字段，若存在必须与 topic 中的 participantId 一致，由 bridge 校验；lastReadAt 为 ISO 8601 消息时间戳）及导出类型 `RoomReadsPayload`。
  - 新增 ServerEvent `read.updated`（`{ roomId, participantId, lastReadAt }`）及 `ReadUpdatedEventSchema` / `ReadUpdatedEvent` 类型。
  - `API_ROUTES` 新增 `roomReadState(id)`（`GET /api/v1/rooms/{id}/read-state`）与 `RoomReadStateResponseSchema`（含从未读过的成员，lastReadAt 为 null）。
- `@opc/server`：bridge 订阅 reads 通配 topic，校验成员身份后单调推进已读游标并 fan-out `read.updated`；实现 `GET /rooms/{id}/read-state`；reads topic 的 ACL 写权限与 uplink 一致。
- `@logact-pub/opc-sdk`：`OpcClient` 新增 `markRoomRead(roomId, lastReadAt)`；`OpcHttpClient` 新增 `getRoomReadState(roomId)`。
- `@opc/agent-gateway`：agent 处理完房间消息后自动向 reads topic 上报已读回执。

均为纯新增，向后兼容。
