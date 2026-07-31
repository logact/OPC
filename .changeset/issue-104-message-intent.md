---
'@logact-pub/opc-protocol': minor
'@logact-pub/opc-sdk': minor
'@opc/server': minor
'@opc/database': minor
---

feat: 消息 intent（'task' | 'question'）端到端支持（issue #104）

- `@logact-pub/opc-protocol`：新增 `MessageIntentSchema` / `MessageIntent` 类型；
  `MessageSchema` 与 `BroadcastMessageRequestSchema` 新增可选 `intent` 字段；
  `UplinkPayload` 新增可选 `intent`。
- `@logact-pub/opc-sdk`：`OpcClient.sendText(roomId, text, intent?, clientMessageId?)`
  支持携带 intent（原第三参 `clientMessageId` 移至第四参——仓库内无三方调用，无实际破坏）。
- `@opc/server` / `@opc/database`：MQTT uplink 与 HTTP broadcast 的 intent 透传落库
  （`messages` 表新增 `intent` 列，migration 0006），`message.delivered` 事件与
  room history 均透出 intent。

intent 全链路可选，缺省时行为与此前完全一致，向后兼容。
