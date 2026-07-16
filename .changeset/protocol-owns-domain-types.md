---
"@logact-pub/opc-protocol": minor
---

refactor(protocol): 移除对 @logact-pub/opc-core 的未使用依赖,领域类型统一由 protocol 拥有

- protocol 源码从未 import opc-core,该依赖是历史遗留;移除后 opc-core 不再需要发布到 npm
- 核心领域模型类型(Room / Participant / Message / ServerEvent 等)继续从本包的 Zod schema 推导导出,本次新增 ParticipantKind 类型导出
- 对消费方无破坏性变更:API 路由、schema 校验规则、MQTT topic 与负载格式均未改变
