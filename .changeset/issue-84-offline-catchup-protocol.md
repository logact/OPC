---
'@logact-pub/opc-protocol': minor
---

feat(protocol): 离线 agent 消息补投的 API 契约（issue #84）

- `API_ROUTES` 新增 `participantRooms(id)`：`GET /api/v1/participants/{id}/rooms`，列出 participant 所在的全部房间。
- 新增 `RoomHistoryQuerySchema`：`GET /rooms/{id}/history` 支持可选查询参数 `since`（ISO 8601 时间戳），仅返回 timestamp 严格大于 since 的消息，供 gateway 按水位游标增量拉取。

均为纯新增，向后兼容；`since` 缺省时 history 行为不变。
