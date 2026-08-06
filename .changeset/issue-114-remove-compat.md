---
'@logact-pub/opc-protocol': major
'@opc/server': major
---

Remove #112 temporary authorization compatibility layer and legacy `opc/rooms/{roomId}/uplink` topic.

Breaking changes:
- `MQTT_TOPICS.uplink` and `MQTT_TOPICS.uplinkFilter` removed; use `MQTT_TOPICS.participantUplink(participantId, roomId)` and `MQTT_TOPICS.participantUplinkFilter`.
- `parseUplinkTopic` removed; use `parseParticipantUplinkTopic`.
- `authorizationMode` option and `AUTHORIZATION_MODE` env var removed; `enforce` is now the only mode.
- Participant registration now always requires an authenticated Owner after the first human bootstrap.
- Gateway MQTT uplink proxy must publish to `opc/participants/{agentId}/rooms/{roomId}/uplink`.

Migration:
- Update clients/gateways to publish to the participant-addressed uplink topic.
- Remove any `AUTHORIZATION_MODE=compat` configuration.
- Ensure the first human participant is bootstrapped before registering other participants; subsequent registrations require Owner credentials.
