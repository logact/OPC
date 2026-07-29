---
'@opc/server': minor
'@opc/database': minor
'@logact-pub/opc-sdk': minor
'@opc/api-client': minor
---

feat(server, database, sdk, api-client): 持久化 agent 的 gatewayId（issue #73）

- `@opc/database`：`participants` 表新增可空列 `gateway_id`（migration 0004）；`register` 仅对 `kind='agent'` 持久化 `gatewayId`，重复注册提供新值时换绑、缺省时保留既有归属。
- `@opc/server`：注册路由将 `gatewayId` 传入 repo；`GET /api/v1/participants` 支持 `?gatewayId=` 过滤并与 `?kind=` 组合；participant get/list/login 响应携带 `gatewayId`。
- `@logact-pub/opc-sdk`：`listParticipants(kind?, gatewayId?)` 新增第二参数（向后兼容）。
- `@opc/api-client`：`list({ kind?, gatewayId? })` 支持 gateway 过滤；响应经 protocol Zod schema 运行时校验后带出 `gatewayId`。
