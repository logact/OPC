# @opc/server

## 1.2.0

### Minor Changes

- eddf19e: Add API contract tests (`apps/server/e2e/contract.test.ts`) that validate HTTP and MQTT payloads against `@logact-pub/opc-protocol` schemas. Add `repository` and `publishConfig` to `@logact-pub/opc-core` and `@logact-pub/opc-protocol` to prepare for npm registry publishing.

### Patch Changes

- eddf19e: Export domain models (`Participant`, `Room`, `Message`, `MessageContent`) and concrete server event types (`MessageDeliveredEvent`, `ParticipantJoinedEvent`, `ParticipantLeftEvent`, `RoomUpdatedEvent`) from `@logact-pub/opc-protocol`. The OpenAPI document `info.version` in `@opc/server` is now read from `apps/server/package.json` instead of being hard-coded.
- Updated dependencies [eddf19e]
- Updated dependencies [eddf19e]
  - @logact-pub/opc-protocol@0.1.0
  - @logact-pub/opc-core@0.0.2
  - @opc/database@0.0.2

## 1.1.3

### Patch Changes

- 982d989: Fix `deploy-development-on-release.yml` by adding `--repo` to `gh workflow run` so it can trigger deployment without checking out the repository.
- db3c632: Serve the Scalar API reference JavaScript bundle from a local endpoint (`/scalar/api-reference.js`) instead of loading it from the jsdelivr CDN, so the `/docs` page works in environments where the CDN is blocked or slow.

## 1.1.2

### Patch Changes

- f9835ad: - Skip changeset check for release PRs (branches matching `release/v*`) to prevent false failures when consuming changesets.
  - Use `RELEASE_PAT` instead of `GITHUB_TOKEN` in `tag-release.yml` so that pushing the version tag triggers downstream CI and development deployment workflows.

## 1.1.1

### Patch Changes

- 1c9eb79: 修复 mosquitto-go-auth HTTP 后端回调的 schema：superuser 回调仅发送 username，拆分为独立的 MqttAuthSuperuserRequestSchema；MQTT ACL/user/superuser 回调中的 clientid 允许 null；parseRoomTopic 支持 opc/rooms/+/uplink 通配 topic。
- Updated dependencies [1c9eb79]
  - @opc/protocol@0.0.2

## 1.1.0

### Minor Changes

- 6bb0e3f: Add storage management APIs for rooms, participants, and messages:
  - `GET /api/v1/rooms/:id` and `PATCH /api/v1/rooms/:id`
  - `GET /api/v1/participants/:id` and `PATCH /api/v1/participants/:id`
  - `GET /api/v1/messages/:id`
  - Corresponding SDK methods and repository updates

### Patch Changes

- b3ded96: Add production deployment workflow and Docker Compose setup

## 1.1.0-rc.0

### Minor Changes

- 6bb0e3f: Add storage management APIs for rooms, participants, and messages:
  - `GET /api/v1/rooms/:id` and `PATCH /api/v1/rooms/:id`
  - `GET /api/v1/participants/:id` and `PATCH /api/v1/participants/:id`
  - `GET /api/v1/messages/:id`
  - Corresponding SDK methods and repository updates

### Patch Changes

- b3ded96: Add production deployment workflow and Docker Compose setup

## 1.0.1

### Patch Changes

- Patch release

## 1.0.0

### Major Changes

- 2d29995: 架构改造：实时通讯从 WebSocket 迁移到 MQTT（Mosquitto broker，客户端直连）。server 订阅上行 topic 校验落库后向房间 events topic 转发事件；参与者注册发放 token，broker 经 mosquitto-go-auth HTTP 回调 server 完成认证与房间成员级 ACL。WebSocket 链路完全移除。

## 1.0.0-rc.0

### Major Changes

- 2d29995: 架构改造：实时通讯从 WebSocket 迁移到 MQTT（Mosquitto broker，客户端直连）。server 订阅上行 topic 校验落库后向房间 events topic 转发事件；参与者注册发放 token，broker 经 mosquitto-go-auth HTTP 回调 server 完成认证与房间成员级 ACL。WebSocket 链路完全移除。
