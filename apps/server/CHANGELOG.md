# @opc/server

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
