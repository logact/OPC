---
'@opc/server': minor
'@logact-pub/opc-sdk': minor
---

feat(server, sdk): agent gateway integration support

- `@opc/server`:
  - `MqttBridge` exposes `publishGatewayCommand(gatewayId, command)` to publish `agent.spawn` / `agent.stop` to gateway control topics.
  - Registering a participant with `kind: 'agent'` and a `gatewayId` triggers an `agent.spawn` command after registration.
  - MQTT ACL endpoint allows a gateway to subscribe only to its own `opc/gateways/{gatewayId}/control` topic.
- `@logact-pub/opc-sdk`:
  - `OpcHttpClient.registerParticipant` accepts optional `kind` and `gatewayId` arguments.
  - `OpcClientOptions` exposes an optional `connectFn` for test injection.

All changes are backward-compatible additions.
