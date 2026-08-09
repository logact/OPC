---
'@logact-pub/opc-protocol': minor
'@logact-pub/opc-sdk': minor
'@opc/server': minor
'@opc/api-client': minor
'@opc/mqtt-client': minor
---

feat(messages): live conversation previews and unread badges (issue #96)

- `GET /api/v1/participants/{id}/rooms` now returns membership-scoped
  `RoomWithState` entries with server-calculated `unreadCount` and `lastMessage`.
  Existing consumers that parse this route as `ListRoomsResponse` remain
  compatible because the added room fields are ignored by their schema.
- The mobile MQTT client keeps a durable per-device session and reconciles all
  joined-room event subscriptions in batches, allowing background conversations
  to update their preview and unread badge after reconnecting.
- The mobile Chats screen displays preview text, latest-message time, and an
  accessible unread badge; opening a conversation clears its local badge while
  the existing read-receipt flow persists the cursor.

All changes are additive and backward compatible.
