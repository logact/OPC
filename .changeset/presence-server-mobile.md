---
'@opc/server': minor
'@opc/database': minor
'@opc/mqtt-client': minor
'@opc/agent-gateway': minor
'@opc/mobile': minor
---

feat: participant/gateway 在线状态（presence，issue #72）

- `@opc/database`：participants 表新增 `online`、`last_seen` 列（migration 0003）；repository 新增 `setPresence`，查询方法带出 presence。
- `@opc/server`：mqtt-bridge 订阅 `opc/participants/+/presence` 并持久化在线状态（lastSeen 为 server 接收时间；重启后经 retained 回放恢复）；ACL 放开 presence topic 全员可读、仅本人可写。
- `@opc/mqtt-client`：连接注册 LWT、上线发 retained online、优雅断开先发 offline；新增 `subscribePresence` 订阅全员状态变化。
- `@opc/agent-gateway`：gateway 自身连接同样上报 presence（agent 连接经 SDK 已覆盖）。
- `@opc/mobile`：Contacts 页渲染在线状态点与 lastSeen 相对时间（focus 拉取 + presence 订阅实时更新）；Me 页绿点改为真实连接状态。

均为向后兼容的新增。
