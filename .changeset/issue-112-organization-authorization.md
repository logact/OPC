---
'@logact-pub/opc-protocol': major
'@logact-pub/opc-sdk': major
'@opc/server': major
'@opc/database': major
'@opc/api-client': major
'@opc/mqtt-client': major
'@opc/agent-gateway': major
---

feat: enforce organization-scoped authorization across HTTP and MQTT (issue #112)

- Breaking protocol changes: capability names are now a closed catalog; rooms
  now require `creatorId`, `type`, and nullable `departmentId`; authenticated
  HTTP broadcasts derive `from` from the Bearer identity; MQTT uplinks move to
  `opc/participants/{participantId}/rooms/{roomId}/uplink`.
- Adds organization Owner, active-position scope union, department-leader
  subtree authority, delegation ceilings, direct-room privacy, group room
  ownership/membership enforcement, and append-only authorization audit APIs.
- Adds task authorization resource/grant contracts for downstream issue #109
  without adding task routes.

Migration: consumers must switch to the protocol capability catalog, populate
the new room ownership fields, stop supplying a different HTTP `from`, and
publish MQTT uplinks to `MQTT_TOPICS.participantUplink(participantId, roomId)`.
The server retains `OPC_AUTHORIZATION_MODE=compat` plus the legacy uplink topic
as an explicit temporary compatibility layer until issue #114; enforcement is
the default.
