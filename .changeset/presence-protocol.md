---
'@logact-pub/opc-protocol': minor
---

feat(protocol): participant/gateway 在线状态（presence，issue #72）

- `ParticipantSchema` 新增可选字段 `presence { online, lastSeen }`（从未上线的 participant 无此字段）。
- 新增 `PresenceSchema`、`PresencePayloadSchema` 及导出类型 `Presence`、`PresencePayload`。
- `MQTT_TOPICS` 新增 `presence(participantId)` 与 `presenceFilter`，并新增 `parsePresenceTopic`。

均为纯新增，向后兼容。
