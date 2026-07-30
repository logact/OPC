---
'@opc/server': minor
'@opc/database': minor
'@opc/agent-gateway': minor
'@opc-pub/agent-edge-app': minor
---

feat: 离线 agent 消息留存与重连补投（issue #84）

- `@opc/server`：新增 `GET /api/v1/participants/{id}/rooms`；`GET /rooms/{id}/history` 支持 `?since=` 增量过滤；注册 agent 时把 spawn 参数持久化到 `participant.metadata.spawn`；gateway 上线（online presence）时按持久化参数重发其名下所有 agent 的 `agent.spawn`；mqtt-bridge 改为固定 clientId + `clean: false` 持久会话。
- `@opc/database`：roomRepo 新增 `listByParticipantId`；messageRepo `findByRoomId` 支持 `since` 过滤。
- `@opc/agent-gateway`：MQTT 连接改为固定 clientId + `clean: false`（broker 离线排队）；新增 `node:sqlite` 状态库存储 per-agent-per-room 水位游标；spawn / 重连后按水位经 HTTP 历史增量补投，并对 broker 队列与 HTTP 拉取的重叠消息幂等去重；新增 `stateDbPath` 选项（默认 `:memory:`）。
- `@opc-pub/agent-edge-app`：新增 `EDGE_STATE_DB` 环境变量（默认 `~/.opc-gateway/state.db`）。

均为向后兼容的新增行为。
