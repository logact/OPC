---
'@logact-pub/opc-protocol': major
---

feat(protocol)!: gateway 单连接多路复用 agent 消息（issue #80）

MQTT 通信模型重构：每台边缘机器上的 gateway 以**单条 MQTT 连接**多路复用本机所有
agent 的消息收发，agent 不再有独立 MQTT 连接。

破坏点：

- 新增 agent 数据面 topic：`opc/agents/{agentId}/events`（`MQTT_TOPICS.agentEvents`，
  附 `parseAgentEventsTopic`）。server 下行时把房间事件 fan-out 到房间内每个
  `kind='agent'` 成员的 agent topic；agent 所属 gateway 订阅这些 topic 后按 agentId
  路由到对应 runtime。旧模型下 agent 直连 broker 订阅 `opc/rooms/{roomId}/events`
  的路径不再是 gateway agent 的数据面。
- `GatewaySpawnCommandSchema.token` 由必填改为可选并标记 deprecated：gateway 单连接后
  agent 不再需要独立 MQTT 凭据，server 停止在 `agent.spawn` 命令中下发 token。
- ACL 语义变化（server 侧实现，随协议一起发布）：
  - `opc/agents/{agentId}/events`：仅归属 gateway（username == agent.gatewayId）可订阅；
  - 房间 uplink：放行 gateway 代发（其名下任一 agent 是房间成员），payload `from`
    为 agentId；
  - presence：gateway 可写其名下 agent 的 presence topic（agent presence 改由 gateway
    按 runtime 真实状态上报）。

迁移说明：

- gateway 升级到新版本即可，无需数据迁移；旧版“每 agent 一条连接”的部署在升级后
  由 gateway 单连接取代。
- 消费 `agent.spawn` 命令的自建 gateway：`token` 字段保留一期作兼容层（旧命令仍带
  token 时可正常解析），下一版本移除，请勿再依赖它建立 per-agent 连接。
- mobile / 人类参与者的直连 MQTT 路径（房间 uplink/events、自身 presence）不受影响。

兼容层保留期限：`token` 可选字段保留一个 major 版本周期，在下一次 major 中移除。
