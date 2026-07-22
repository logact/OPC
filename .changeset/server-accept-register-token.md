---
'@opc/server': patch
'@opc/database': patch
---

fix(server): HTTP Bearer 鉴权接受 register 发放的 participant token

#41 把 `/api/v1/*` 限制为只接受 JWT，但 mobile 端持有的是 `POST /api/v1/participants`(register）返回的不透明 token（与 MQTT CONNECT 同一凭据），导致 app 所有鉴权 HTTP 请求（房间列表、参与者列表等）一律 401，房间列表一直转圈。

- `apps/server` 鉴权中间件：`jwtVerify` 失败后回退到 `participantRepo.findByToken` 查询
- `packages/database` 新增 `findByToken`（按 `token_hash` 查找参与者）

迁移说明：无破坏性变更；已部署 server 升级后 mobile 端无需改动即可恢复。
