---
'@logact-pub/opc-sdk': minor
---

`OpcClient` 的实时方法变为 ack 感知：`connect()` / `subscribeRoom()` / `unsubscribeRoom()` / `sendText()` 现在返回 `Promise<void>`，分别在 broker 的 CONNACK / SUBACK / UNSUBACK / PUBACK 到达时 resolve，失败（认证拒绝、ACL 拒绝等）时 reject；错误仍同时通过 `events.emit('error')` 上报。

向后兼容：原有 fire-and-forget 调用方（忽略返回值）不受影响；`sendDirectMessage()` 现在会等待上行消息被 broker 确认。
