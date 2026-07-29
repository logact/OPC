---
'@logact-pub/opc-sdk': minor
---

feat(sdk): OpcClient 上报在线状态（presence，issue #72）

- CONNECT 时注册 LWT：retained `{online:false}` 到 `opc/participants/{id}/presence`；
- 每次（重）连成功发布 retained `{online:true}`；
- `disconnect()` 先发布 retained offline 再关闭连接（已断开时跳过，由 broker LWT 兜底）。

异常断线由 broker 发布 LWT，server 订阅 presence 通配 topic 维护在线状态。向后兼容。
