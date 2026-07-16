# @opc/protocol

## 0.3.0

### Minor Changes

- 43085fd: feat(auth): 新增基于用户名/密码的 JWT 登录，HTTP 业务接口默认需要 Bearer token

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

- 43085fd: refactor(protocol): 移除对 @logact-pub/opc-core 的未使用依赖,领域类型统一由 protocol 拥有

  - protocol 源码从未 import opc-core,该依赖是历史遗留;移除后 opc-core 不再需要发布到 npm
  - 核心领域模型类型(Room / Participant / Message / ServerEvent 等)继续从本包的 Zod schema 推导导出,本次新增 ParticipantKind 类型导出
  - 对消费方无破坏性变更:API 路由、schema 校验规则、MQTT topic 与负载格式均未改变

## 0.2.0

### Minor Changes

- 833cf1a: refactor(protocol): 移除对 @logact-pub/opc-core 的未使用依赖,领域类型统一由 protocol 拥有

  - protocol 源码从未 import opc-core,该依赖是历史遗留;移除后 opc-core 不再需要发布到 npm
  - 核心领域模型类型(Room / Participant / Message / ServerEvent 等)继续从本包的 Zod schema 推导导出,本次新增 ParticipantKind 类型导出
  - 对消费方无破坏性变更:API 路由、schema 校验规则、MQTT topic 与负载格式均未改变

## 0.1.0

### Minor Changes

- eddf19e: Export domain models (`Participant`, `Room`, `Message`, `MessageContent`) and concrete server event types (`MessageDeliveredEvent`, `ParticipantJoinedEvent`, `ParticipantLeftEvent`, `RoomUpdatedEvent`) from `@logact-pub/opc-protocol`. The OpenAPI document `info.version` in `@opc/server` is now read from `apps/server/package.json` instead of being hard-coded.

### Patch Changes

- eddf19e: Add API contract tests (`apps/server/e2e/contract.test.ts`) that validate HTTP and MQTT payloads against `@logact-pub/opc-protocol` schemas. Add `repository` and `publishConfig` to `@logact-pub/opc-core` and `@logact-pub/opc-protocol` to prepare for npm registry publishing.
- Updated dependencies [eddf19e]
  - @logact-pub/opc-core@0.0.2

## 0.0.2

### Patch Changes

- 1c9eb79: 修复 mosquitto-go-auth HTTP 后端回调的 schema：superuser 回调仅发送 username，拆分为独立的 MqttAuthSuperuserRequestSchema；MQTT ACL/user/superuser 回调中的 clientid 允许 null；parseRoomTopic 支持 opc/rooms/+/uplink 通配 topic。
