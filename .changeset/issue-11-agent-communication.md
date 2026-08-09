---
'@opc/agent-edge': minor
'@opc/agent-gateway': minor
---

feat: allow managed agents to create and use direct or group chats (issue #11)

- `@opc/agent-edge` adds transport-neutral `create_direct_room`,
  `create_group_room`, and `send_room_message` tools. They are available to
  both chat and goal threads; execution tools remain goal-only.
- `@opc/agent-gateway` binds each runtime's tools to its gateway-authorized
  HTTP identity and the existing proxied MQTT uplink.
- The server permits a gateway to delegate only existing room-creation POST
  endpoints for its own agents; the agent still needs the ordinary
  `room.create` capability and message sends remain subject to room-membership
  ACLs.
