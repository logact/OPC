---
'@logact-pub/opc-protocol': minor
---

feat(protocol): 支持 agent gateway 控制面

- `RegisterParticipantRequestSchema` 新增可选字段 `kind` 与 `gatewayId`。
- 新增 `GatewayCommandSchema` 与导出类型 `GatewayCommand`，包含 `agent.spawn` / `agent.stop`。
- `MQTT_TOPICS` 新增 `gatewayControl(gatewayId)`，并新增 `parseGatewayControlTopic` 用于 ACL 解析。

均为纯新增，向后兼容。
