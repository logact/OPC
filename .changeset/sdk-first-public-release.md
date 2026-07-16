---
"@logact-pub/opc-sdk": minor
---

feat(sdk): 以 @logact-pub/opc-sdk 之名首次公开发布(原内部包 @opc/sdk)

- 包名由 @opc/sdk 变更为 @logact-pub/opc-sdk,发布到 npm registry 供移动端等消费方按版本引用
- ServerEvent 等领域类型改从 @logact-pub/opc-protocol 引入,不再依赖 @logact-pub/opc-core
- EventBus 改用裸 'events' 导入:Node 下解析为内置模块,React Native/Metro 下解析为 events polyfill(与 mqtt.js 一致),为 RN 消费做准备
