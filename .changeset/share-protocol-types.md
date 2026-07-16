---
'@logact-pub/opc-protocol': minor
'@opc/server': patch
---

Export domain models (`Participant`, `Room`, `Message`, `MessageContent`) and concrete server event types (`MessageDeliveredEvent`, `ParticipantJoinedEvent`, `ParticipantLeftEvent`, `RoomUpdatedEvent`) from `@logact-pub/opc-protocol`. The OpenAPI document `info.version` in `@opc/server` is now read from `apps/server/package.json` instead of being hard-coded.
