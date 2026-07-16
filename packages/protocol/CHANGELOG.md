# @opc/protocol

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
