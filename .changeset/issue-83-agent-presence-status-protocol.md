---
'@logact-pub/opc-protocol': minor
---

feat(protocol): agent presence 增加忙闲状态字段（issue #83）

向后兼容的可选字段新增：

- 新增 `AgentPresenceStatusSchema`（`'idle' | 'working' | 'blocking' | 'error'`）
  及推导类型 `AgentPresenceStatus`。offline 不进入此枚举——它由连接层
  `online: false` 表达；展示层按 `!online → offline; online → status ?? 'idle'`
  合成 5 态。
- `PresencePayloadSchema`（MQTT presence topic 负载）与 `PresenceSchema`
  （`Participant.presence`）各新增可选 `status` 字段。

仅 `kind='agent'` 的 participant 发布 status（由其归属 gateway 代发）；人类
participant 不携带。旧消费方忽略未知字段即可，无需迁移。
