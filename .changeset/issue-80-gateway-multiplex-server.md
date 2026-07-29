---
'@opc/server': minor
'@opc/database': minor
'@opc/agent-gateway': minor
'@opc-pub/agent-edge-app': minor
---

feat: gateway 单连接多路复用 agent 消息（issue #80）

- `@opc/database`：`ParticipantRepository` 新增 `findByIds`（批量解析房间成员）与
  `listByGatewayId`（presence 级联与 gateway ACL 判定）。
- `@opc/server`：
  - mqtt-bridge 下行统一走 `publishToRoom`：房间事件除 `opc/rooms/{roomId}/events` 外，
    fan-out 到房间内每个 `kind='agent'` 成员的 `opc/agents/{agentId}/events`；
  - presence 级联：gateway 掉线（LWT/显式 offline）时，其名下所有 agent 一并置为
    offline 并覆写 retained presence；
  - ACL 新规则：agent events topic 仅归属 gateway 可订阅；gateway 可向其名下 agent
    所在房间代发 uplink；gateway 可写名下 agent 的 presence；
  - 注册 agent 时 `agent.spawn` 命令不再下发 token（protocol 中该字段已转可选兼容层）。
- `@opc/agent-gateway`：重构为单连接多路复用——`AgentGateway` 移除 per-agent
  `OpcClient` 与 5s 房间轮询；spawn 时在同一连接订阅 `opc/agents/{agentId}/events`，
  入站按 agentId 路由（串行处理保证 spawn/stop/事件顺序），出站经 `agent.onMessage`
  由 gateway 统一代发 uplink；agent presence 由 gateway 按 runtime 真实状态上报
  （spawn 成功 online、spawn 失败 / thread error / stop 置 offline）。`AgentGatewayOptions`
  移除 `roomSyncIntervalMs`，`AdminAgentEntry` 移除 `subscribedRooms`，删除
  `isAgentSubscribedToRoom` 诊断接口；不再依赖 `@logact-pub/opc-sdk`。
- `@opc-pub/agent-edge-app`：`agents list` / `agents info` 移除 ROOMS 列（agent 不再
  直接订阅房间，房间归属由 server fan-out 处理）。
