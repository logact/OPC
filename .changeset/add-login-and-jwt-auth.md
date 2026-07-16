---
"@logact-pub/opc-protocol": minor
"@logact-pub/opc-sdk": minor
---

feat(auth): 新增基于用户名/密码的 JWT 登录，HTTP 业务接口默认需要 Bearer token

- 在 `API_ROUTES.auth` 下新增 `POST /api/v1/auth/login`
- `RegisterParticipantRequestSchema` 新增可选 `password` 字段，注册时可同时设置登录密码
- 新增 `LoginRequestSchema` / `LoginResponseSchema` 及对应 TS 类型
- `packages/database` 在 `participants` 表新增 `password_hash`，与 MQTT `token_hash` 解耦
- `apps/server` 增加全局 Bearer JWT 鉴权中间件；除 `POST /api/v1/auth/login`、`POST /api/v1/auth/mqtt/*`、`POST /api/v1/participants` 及 OpenAPI 文档外，`/api/v1/*` 均需 `Authorization: Bearer <token>`
- `OpcHttpClient` 新增 `login()`、`setAccessToken()`，所有请求自动携带 token；`registerParticipant()` 支持传入密码
- 新增必填环境变量 `JWT_SECRET`，可选 `JWT_EXPIRES_IN`（默认 `7d`）

迁移说明：
- 现有 MQTT 连接方式不变，仍使用注册返回的 token
- 已有未设置密码的参与者无法通过新登录接口登录，需重新注册或调用服务端密码设置流程
