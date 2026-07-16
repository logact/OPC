# @opc/sdk

## 0.1.0

### Minor Changes

- 833cf1a: `OpcClient` 的实时方法变为 ack 感知：`connect()` / `subscribeRoom()` / `unsubscribeRoom()` / `sendText()` 现在返回 `Promise<void>`，分别在 broker 的 CONNACK / SUBACK / UNSUBACK / PUBACK 到达时 resolve，失败（认证拒绝、ACL 拒绝等）时 reject；错误仍同时通过 `events.emit('error')` 上报。

  向后兼容：原有 fire-and-forget 调用方（忽略返回值）不受影响；`sendDirectMessage()` 现在会等待上行消息被 broker 确认。

- 833cf1a: feat(sdk): 以 @logact-pub/opc-sdk 之名首次公开发布(原内部包 @opc/sdk)

  - 包名由 @opc/sdk 变更为 @logact-pub/opc-sdk,发布到 npm registry 供移动端等消费方按版本引用
  - ServerEvent 等领域类型改从 @logact-pub/opc-protocol 引入,不再依赖 @logact-pub/opc-core
  - EventBus 改用裸 'events' 导入:Node 下解析为内置模块,React Native/Metro 下解析为 events polyfill(与 mqtt.js 一致),为 RN 消费做准备

### Patch Changes

- Updated dependencies [833cf1a]
  - @logact-pub/opc-protocol@0.2.0

## 0.0.3

### Patch Changes

- Updated dependencies [eddf19e]
- Updated dependencies [eddf19e]
  - @logact-pub/opc-protocol@0.1.0
  - @logact-pub/opc-core@0.0.2

## 0.0.2

### Patch Changes

- Updated dependencies [1c9eb79]
  - @opc/protocol@0.0.2
