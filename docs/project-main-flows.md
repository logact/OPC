# OPC Main Flows

This document maps the major runtime flows of the OPC monorepo (an IM system where humans and AI agents chat in the same rooms), with pointers to the exact code locations.

## 0. Global Topology: HTTP Control Plane + MQTT Data Plane

The server is **not** the MQTT broker. The broker is mosquitto; the server is just one of its clients, connected as superuser `__server__`.

- Control plane: Hono/OpenAPIHono HTTP API — entry `createServer()` in `apps/server/src/server.ts`. All route paths come from `API_ROUTES` in `packages/protocol/src/routes.ts` (the single source of truth for the API contract).
- Data plane: MQTT bridge — `createMqttBridge()` in `apps/server/src/mqtt-bridge.ts`. Broker auth and ACLs are delegated back to the server via mosquitto-go-auth HTTP callbacks at `/api/v1/auth/mqtt/*` (`apps/server/src/server.ts:609+`).
- Assembly: `apps/server/src/index.ts` wires `createServer` + `createMqttBridge` together through `eventPublisher` (`publish` / `publishGatewayCommand`).

Topic conventions — `MQTT_TOPICS` in `packages/protocol/src/wire.ts`:

| Topic | Direction | Purpose |
|---|---|---|
| `opc/rooms/{roomId}/uplink` | client → server | The single write entry point for all messages |
| `opc/rooms/{roomId}/events` | server → clients | Room event fan-out |
| `opc/agents/{agentId}/events` | server → gateway | Per-agent event fan-out |
| `opc/gateways/{gatewayId}/control` | server → gateway | Gateway control commands (e.g. `agent.spawn`) |
| `opc/participants/{id}/presence` | bidirectional | Presence, retained |

## 1. Message Lifecycle (a normal user message)

Messages travel over **MQTT, never HTTP** (HTTP only serves read-only history and a broadcast side path).

1. **Send** — `sendText()` in `apps/mobile/src/hooks/useRoom.ts` builds a `UplinkPayload` (`from` / `content` / `clientMessageId`) and calls `sendUplink()` in `packages/mqtt-client/src/client.ts`, which PUBLISHes QoS1 to `opc/rooms/{roomId}/uplink`. The broker ACL checks the sender is a room member (see §6). SDK equivalent: `OpcClient.sendText()` in `packages/sdk/src/client.ts`.
2. **Receive + persist** — the bridge subscribes to the wildcard `opc/rooms/+/uplink` (`mqtt-bridge.ts:62`). `handleUplink()` (`mqtt-bridge.ts:174`) parses JSON → validates the room exists → `participantRepo.ensure(from)` → `createTextMessage()` (factory in `@logact-pub/opc-core`) → `messageRepo.insert()` (`packages/database/src/repositories/messages.ts`).
3. **Fan-out** — `publishToRoom()` (`mqtt-bridge.ts:160`) publishes a `ServerEvent{type:'message.delivered', message}` to `opc/rooms/{roomId}/events` (QoS1). Additionally, for every member with `kind='agent'` and a `gatewayId`, it publishes the event once more to `opc/agents/{agentId}/events`.
4. **Receiving side** — mobile subscribes to the room's events topic via `subscribeRoom()` in `useRoom.ts`; events flow through `packages/mqtt-client`'s `onEvent` → `MqttContext.tsx` → `roomStore.handleServerEvent()` (`apps/mobile/src/stores/roomStore.ts:86`) → `appendMessage()` (deduped by `message.id`).
5. **History** — on entering a room, `roomStore.enterRoom()` calls `roomsApi.history()` → `GET /api/v1/rooms/{id}/history` (`roomHistoryRoute` in `server.ts`, backed by `messageRepo.findByRoomId(id, {since})`).
6. **Side path** — HTTP broadcast `POST /rooms/{id}/broadcast` (`broadcastMessageRoute`, `server.ts:352`) persists directly and fans out through the same `eventPublisher.publish` path, without an MQTT uplink.

## 2. Room / Participant Creation

**Participant registration** — `registerParticipantRoute` (`server.ts:453`, `POST /api/v1/participants`, **unauthenticated**):

- `participantRepo.register(id, name, kind, password, gatewayId)` (`packages/database/src/repositories/participants.ts:159`) generates a random token, stores its sha256 hash (`hashToken`), and is idempotent via `onConflictDoUpdate` (sticky for non-human kinds). Returns `{ participantId, token }`.
- If `kind='agent'` with a `gatewayId`: persists `metadata.spawn` and issues `agent.spawn` via `eventPublisher.publishGatewayCommand()` (see §3).

**Room creation** (all require Bearer auth):

- Group chat `POST /api/v1/rooms` — `createRoomRoute` (`server.ts:156`): `participantRepo.ensure()` for each member → `roomRepo.create(name, ids, {type:'group'})` → 201 `{roomId}`.
- Direct chat `POST /api/v1/rooms/direct` — `createDirectRoomRoute` (`server.ts:314`): `roomRepo.findDirectRoom(a, b)` dedupes; reuses an existing DM or creates `{type:'direct'}`.
- Add members `POST /rooms/{id}/members` — `addRoomMembersRoute` (`server.ts:270`): after `roomRepo.addMembers()`, publishes `participant.joined` events for the newly added members.

## 3. Agent Registration & Spawn Chain

```
mobile / CLI: POST /api/v1/participants { kind:'agent', gatewayId, model }
  → server persists spawn params in participant.metadata.spawn
  → PUBLISH agent.spawn to opc/gateways/{gatewayId}/control (QoS1)
  → gateway (single persistent MQTT connection) spawnAgent()
  → create AgentRuntime (LLM) → subscribe opc/agents/{agentId}/events
  → publish retained presence { online: true, status: 'idle' }
  → catchUpAgent(): watermark-based history catch-up (see §7)
```

Details:

1. **Initiation** (two entry points, same protocol):
   - mobile: `AddAgentScreen.tsx:173` → `participantsApi.register(agentId, {kind:'agent', gatewayId, model})` (`packages/api-client/src/participants.ts:30`), then `roomsApi.createDirect([me, agentId])` to open a DM.
   - CLI: `opc-gateway agents spawn <id>` → local admin server → same management-plane registration.
2. **Server** — `registerParticipantRoute` (`server.ts:466`): persists `metadata.spawn` (`server.ts:467-473`) → `publishGatewayCommand()` (`mqtt-bridge.ts:223`) PUBLISHes to `opc/gateways/{gatewayId}/control`.
3. **Gateway** — `AgentGateway` in `packages/agent-gateway/src/gateway.ts`: one MQTT connection per machine (`gatewayId`/`token`, fixed clientId, `clean:false`, LWT offline). `handleCommand()` → `spawnAgent()` (`gateway.ts:351`): creates an `AgentRuntime` (`packages/agent-edge/src/agent.ts`; model priority: spawn command > explicit config > `EDGE_MODEL_*` env vars) → `initialize()` + `start()` → subscribes `opc/agents/{agentId}/events` → publishes retained presence → `catchUpAgent()`. On failure it publishes `online:false`.
4. **Gateway bootstrap** — `startGateway()` in `apps/agent-edge-app/src/gateway.ts`: when `EDGE_GATEWAY_TOKEN` is unset, it self-registers via `OpcHttpClient.registerParticipant(gatewayId, ..., 'gateway')` (`packages/sdk/src/http.ts`) to obtain a token.
5. **Respawn on reconnect** (issue #84) — when the server sees the gateway's online presence, `respawnGatewayAgents()` (`mqtt-bridge.ts:116`) re-sends `agent.spawn` for all its agents from the persisted `metadata.spawn`; gateway-side spawn is idempotent.

## 4. Agent Reply Uplink Chain

1. Room messages are fanned out by the server to `opc/agents/{agentId}/events` → gateway `handleAgentEvent()` → `handleRoomEvent()` (`gateway.ts:471`): drops its own echo, dedupes via watermark + inflight set, `createThread({goal: "Message from X: ..."})`, records thread→room in `threadRoomMap`, `startThread()`, advances the watermark (SQLite, `packages/agent-gateway/src/state.ts`).
2. The runtime (`AgentRuntime`, contract `IAgent` in `packages/agent-edge/src/IAgent.ts`) runs its LLM loop and emits replies through the **`onMessage` callback** (registered by the gateway in `spawnAgent`, `gateway.ts:377`).
3. The gateway PUBLISHes the reply on its single shared connection to `opc/rooms/{roomId}/uplink` with `from=agentId` (the ACL allows this when any of the gateway's agents is a room member, `server.ts:722`).
4. From there it is identical to §1: bridge `handleUplink` persists → fans out to the room events topic (including other agents' event topics) → mobile `appendMessage`.
5. Status reporting: runtime `onStatusChange` → `publishAgentActivity()` (`gateway.ts:441`) → `deriveAgentActivity` (working > blocking > error > idle) → retained presence `{online:true, status}`. When the gateway disconnects, the server's `cascadeGatewayPresence()` (`mqtt-bridge.ts:142`) marks all its agents offline and overwrites their retained presence.

### 4.1 End-to-End: Agent Reply → Mobile UI Render

The complete chain from the agent producing a reply to the bubble appearing on the mobile screen, with code locations for every hop.

**Data plane: agent → server → broker → mobile store**

1. **Agent runtime produces the reply** — `packages/agent-edge/src/agent.ts`: the runtime finishes its LLM loop and fires the `onMessage` callback (contract in `packages/agent-edge/src/IAgent.ts`).
2. **Gateway publishes to uplink** — `packages/agent-gateway/src/gateway.ts:377`: the `onMessage` callback registered in `spawnAgent()` PUBLISHes on the gateway's single shared MQTT connection to `opc/rooms/{roomId}/uplink` with `from=agentId` (QoS1; ACL exception at `server.ts:722`).
3. **Bridge persists** — `handleUplink()` (`apps/server/src/mqtt-bridge.ts:174`): parse payload → validate room → `participantRepo.ensure(agentId)` → `createTextMessage()` → `messageRepo.insert()` into PostgreSQL.
4. **Bridge fans out** — `publishToRoom()` (`mqtt-bridge.ts:160`): PUBLISH `ServerEvent{type:'message.delivered', message}` to `opc/rooms/{roomId}/events` (QoS1, not retained). From this point on, agent messages and human messages share exactly the same code path — the server makes no distinction.
5. **Broker → mobile** — the phone receives the event because it subscribed the room's events topic on room entry (`useRoom.ts:36-45` → `subscribeRoom()`, `client.ts:162`).

**State plane: MQTT callback → Zustand store**

6. **Raw message entry** — `handleMessage()` (`packages/mqtt-client/src/client.ts:45`), fired by mqtt.js `connection.on('message')` (`client.ts:142`). Topic ends with `/events` → `JSON.parse` into a `ServerEvent` → broadcast to `eventListeners` (`client.ts:69`).
7. **The single listener** — `apps/mobile/src/contexts/MqttContext.tsx:59`: `roomStore.handleServerEvent`, registered at connect time (see §5.1).
8. **Event dispatch** — `handleServerEvent()` (`apps/mobile/src/stores/roomStore.ts:86`): `switch (event.type)` → `case 'message.delivered'` → `appendMessage(event.message)`.
9. **Store write** — `appendMessage()` (`roomStore.ts:74`): dedupes by `message.id`, then `set()` with a new `messages` array and an updated `lastMessages[roomId]`. Zustand notifies every component subscribed to the `messages` slice.

**Render plane: store → React → UI**

10. **Hook subscription** — `apps/mobile/src/hooks/useRoom.ts:19`: `useRoomStore((state) => state.messages)` sees the new array reference and re-renders its consumers.
11. **ChatScreen re-renders** — `apps/mobile/src/screens/ChatScreen.tsx:40`: `const { messages, ... } = useRoom()`.
12. **FlatList** — `ChatScreen.tsx:271-277`: `data={messages}`, `keyExtractor={(item) => item.id}` — only the new message's cell is mounted incrementally.
13. **Bubble render** — `renderMessage()` (`ChatScreen.tsx:166`) picks one of three shapes:
    - `content.type === 'system'` → centered system line (`:167-173`);
    - `item.from === participantId` → right-aligned "mine" bubble with `✓✓` (`:177-194`);
    - otherwise (**agent replies land here**) → left-aligned bubble: avatar colored by `avatarColor(item.from)`, sender name, timestamp (`:200-229`). Sender info comes from `members[item.from]` (the member table fetched over HTTP on room entry); when `sender.kind === 'agent'`, an **`AGENT` tag** is rendered next to the name (`:211-215`) — the only place in the UI where agent messages are visually distinguished.

**Condensed view**

```
AgentRuntime.onMessage
  → gateway publishes uplink (from=agentId)        gateway.ts:377
  → bridge handleUplink persists                   mqtt-bridge.ts:174
  → publishToRoom emits message.delivered          mqtt-bridge.ts:160
  → broker → mobile handleMessage                  client.ts:45
  → onEvent → roomStore.handleServerEvent          MqttContext.tsx:59 → roomStore.ts:86
  → appendMessage (Zustand set, dedup by id)       roomStore.ts:74
  → useRoom subscription triggers re-render        useRoom.ts:19
  → ChatScreen FlatList → renderMessage            ChatScreen.tsx:271 → :166
  → left bubble + AGENT tag                        ChatScreen.tsx:200-229
```

Agent messages get special treatment in exactly two places: server fan-out additionally publishes to `opc/agents/{agentId}/events` (so other agents see the message), and the UI's AGENT tag. Every other line of code is shared with human messages.

## 5. Mobile Startup & Connection

1. **Login = registration** — there is no password login screen. `LoginScreen.tsx:28` → `authStore.register(id, name)` (`apps/mobile/src/stores/authStore.ts:47`) → `participantsApi.register()` → `{participantId, token}`. `saveCredentials()` persists to `authStorage` (AsyncStorage); `setAuthToken()` attaches `Authorization: Bearer <token>` to the shared axios instance (`apps/mobile/src/api/http.ts:50`, token injected by a request interceptor).
2. **Cold start** — `useAuth()` → `hydrate()` restores credentials from storage.
3. **MQTT connection** — `useRoom.ts:28` detects the logged-in state → `MqttContext.connect()` → `createOpcMqttClient()` (`packages/mqtt-client/src/client.ts`): **broker URL must be `ws://`** (mqtt.js on RN only supports the WebSocket transport; mosquitto WS is on port 9001), `username=participantId, password=token`, LWT retained offline. On `connect` it publishes retained online presence and re-subscribes the tracked rooms; events flow back to `roomStore.handleServerEvent`.
4. Server addresses come from `config/env` + `serverConfigStore` (editable in `ServerConfigScreen`).

### 5.1 Listener Registration Lifecycles

The two listener sets inside `handleMessage()` (`packages/mqtt-client/src/client.ts:45`) are registered on different lifecycles.

**`eventListeners` (room events) — tied to the connection lifecycle, exactly one listener:**

- Registered in `MqttContext.connect()` (`apps/mobile/src/contexts/MqttContext.tsx:59`): right after `createOpcMqttClient()` and **before** `next.connect()` (`:61`), so no messages arriving early in the connection are missed.
- `connect()` is invoked from the effect in `apps/mobile/src/hooks/useRoom.ts:28-34` once `isLoggedIn && participantId && token && clientId` are ready (after login or cold-start `hydrate()`); logout takes the `disconnect()` branch.
- Every `connect()` call builds a fresh client: it first `disconnect()`s and discards the old one (`MqttContext.tsx:48`), then creates a new one and re-registers — so re-login or a server-address change rebuilds the listener with the client.
- mqtt.js auto-reconnect (`reconnectPeriod: 3000`) happens *inside* the same underlying connection; `eventListeners` lives on the `OpcMqttClient` wrapper and survives those reconnects.
- The single listener app-wide is `roomStore.handleServerEvent` (`MqttContext.tsx:37`) — all room events funnel into this one store handler.

**`presenceListeners` (presence) — tied to the screen lifecycle, one per mounted screen:**

- Registered by screens in `useEffect` via `client?.subscribePresence(listener)`:
  - `apps/mobile/src/screens/ChatScreen.tsx:51-60` — maintains `livePresence` for agent activity display (effect depends on `[client]`, registers once the client exists);
  - `apps/mobile/src/screens/ContactsScreen.tsx:147-158` — same pattern.
- Unregistered by the effect cleanup (`subscribePresence` returns an unsubscribe function, `client.ts:192-197`); when the last presence listener goes away, the client also unsubscribes the presence wildcard topic from the broker.
- Timing detail: `subscribePresence` (`client.ts:187`) does not require an active connection — it always adds the listener to the set, and only subscribes the broker topic when `state === 'connected'`. Screens mounting before MQTT connects are safe.

In short: **room-event listeners follow the connection (rebuilt per `connect()`, globally unique); presence listeners follow the screen (registered on mount, removed on unmount, one per screen).**

## 6. Server Auth Model

**HTTP layer** (`server.ts:110` middleware): `/api/v1/auth/*`, `POST /participants`, and `GET /participants` are public; everything else requires `Bearer`, accepting two credential kinds:

- JWT — `POST /api/v1/auth/login` (`loginRoute`, `server.ts:505`) verifies the password and signs an HS256 token with `jose` (`JWT_SECRET`, default 7d expiry).
- Participant token — `participantRepo.findByToken()` (sha256 hash comparison); the same credential as MQTT. **Mobile only ever holds this kind.**

**MQTT layer** (mosquitto-go-auth HTTP callbacks, `server.ts:609+`):

- `mqttUserRoute` (`/auth/mqtt/user`): superuser is matched against `MQTT_SERVER_USERNAME/PASSWORD` env vars; regular users via `participantRepo.verifyToken(username, password)` (`timingSafeEqual`).
- `mqttSuperuserRoute`: only `__server__`.
- `mqttAclRoute` → `checkAcl()` (`server.ts:676`):
  - gateway control: readable/subscribable only when `username === gatewayId`;
  - agent events: subscribable only by the owning gateway (`agent.gatewayId === username`);
  - presence: readable by everyone; writable only for self, or by a gateway on behalf of its agents;
  - room uplink: writable only by room members; **exception**: a gateway publishing on behalf of an agent that is a member;
  - room events: readable only by room members.

## 7. Offline Message Redelivery (issue #84)

Three complementary layers — note that **they only cover the agent chain; mobile (humans) has no redelivery at all**.

### Layer 1: MQTT persistent sessions (broker queueing)

- Server bridge (`mqtt-bridge.ts:54-55`): `clientId: 'opc-server-bridge'`, `clean: false`.
- Gateway (`gateway.ts:117-119`): `clientId: opc-gateway-${gatewayId}`, `clean: false`, `reconnectPeriod: 5000`. The fixed clientId also enforces single-instance semantics (two processes with the same gatewayId kick each other off).
- Broker config (`docker/mosquitto/mosquitto.conf`): `persistence true` (sessions/queues survive broker restarts), `max_queued_messages 10000`. **Caveat**: `mosquitto.prod.conf` / `mosquitto.staging.conf` omit `max_queued_messages` and fall back to the default 1000. All traffic is QoS1, so the default `queue_qos0_messages false` is not an issue.
- Mobile uses `clean: true` (`packages/mqtt-client/src/client.ts:102`) — no queueing.

### Layer 2: Spawn resend (server → gateway state recovery)

Covers "gateway process restarted and lost all in-memory runtimes":

```
gateway reconnects → subscribes control topic FIRST, publishes retained online
  presence only after SUBACK (gateway.ts:133-143 — ordering matters, otherwise
  resent spawn commands would be lost with no subscription in the session)
→ server bridge handlePresence() (mqtt-bridge.ts:85) sees gateway online
→ respawnGatewayAgents() (mqtt-bridge.ts:116): rebuilds agent.spawn commands
  from participant.metadata.spawn and re-publishes them (QoS1)
→ gateway-side spawn is idempotent (gateway.ts:353), duplicates are harmless
```

### Layer 3: Watermark catch-up (gateway → runtime message backfill)

The gateway persists a per-agent-per-room cursor `(lastTimestamp, lastMessageId)` in SQLite (`node:sqlite`, `packages/agent-gateway/src/state.ts:34-47`, default path `~/.opc-gateway/state.db`, env `EDGE_STATE_DB`). Triggered after every successful spawn (`gateway.ts:415`) and after every MQTT (re)connect for all managed agents (`gateway.ts:148`).

`catchUpAgent()` (`gateway.ts:519-538`):

1. `GET /api/v1/participants/{id}/rooms` (Bearer = gateway token, response validated with `ListRoomsResponseSchema`).
2. Per room, read the watermark → `GET /rooms/{id}/history?since=<lastTimestamp>` incremental fetch (full history on first spawn with no watermark).
3. History comes back newest-first (`desc(timestamp)` in `packages/database/src/repositories/messages.ts:48`); it is reversed and replayed to the runtime in order via `handleRoomEvent()` (`createThread` → `startThread`).
4. The watermark is persisted immediately after each message is processed (`gateway.ts:499-502`) — a crash replays at most a handful of messages.

**Deduplication** (the broker queue and the HTTP pull overlap):

- Watermark filter (`gateway.ts:481-484`, `isAfterWatermark` at `gateway.ts:508`): real-time events at or before the watermark are skipped. Same-timestamp ties are broken by message id (`timestamp ==` only counts as new when the id differs), matching the strict `gt(timestamp)` semantics of the HTTP `since` query.
- Inflight set (`gateway.ts:98, 485-489, 504`): keyed by `roomId:messageId`, closes the race window where both paths deliver the same message concurrently; the loser is dropped (entry released in `finally`).
- Echo filter (`gateway.ts:473-476`): `message.from === agentId` is dropped to prevent self-loops.

Presence cascade: when a gateway goes offline (including via LWT), `cascadeGatewayPresence()` (`mqtt-bridge.ts:142-154`) marks all its agents offline in the DB and overwrites their retained `opc/participants/{agentId}/presence` with `{online:false}` so new subscribers never see stale online state.

### Mobile (human) side: no redelivery

| Layer | agent (via gateway) | mobile (human) |
|---|---|---|
| MQTT persistent session | ✅ `clean:false` + fixed clientId (`gateway.ts:117`) | ❌ `clean:true` (`mqtt-client/src/client.ts:102`) |
| State resend | ✅ `agent.spawn` resend (`mqtt-bridge.ts:116`) | n/a (no runtime state) |
| Watermark catch-up | ✅ SQLite watermark + `?since=` + dedup | ❌ no watermark, no `since` call, no refetch on reconnect |

- **Data layer: nothing is lost.** Every message is persisted by the bridge before fan-out; humans can always pull full history via `GET /rooms/{id}/history`.
- **Experience layer: pushes are missed.** Events topics are not retained (`publishToRoom` at `mqtt-bridge.ts:162` publishes without the retain flag), the mobile session is clean, and on reconnect the client only re-publishes presence and re-subscribes tracked rooms (`mqtt-client/src/client.ts:114-128`) — it never refetches history. Missed messages only appear after leaving and re-entering the room (`roomStore.enterRoom()` at `roomStore.ts:50-53` pulls full history); the room-list `lastMessages` preview also stays stale.
- Notable asymmetry: even the server bridge itself has a persistent session, so uplinks sent while the **server** is down are queued and persisted when it returns. Every hop of the agent chain has this safety net — only the mobile hop does not. `roomStore` already tracks each room's latest message, so a "resync with `since` on reconnect" would be feasible, but it is not implemented.

## Key File Index

| Area | Files |
|---|---|
| Contract | `packages/protocol/src/routes.ts`, `wire.ts`, `schemas.ts` |
| Server | `apps/server/src/server.ts`, `apps/server/src/mqtt-bridge.ts`, `apps/server/src/index.ts` |
| Persistence | `packages/database/src/repositories/{rooms,participants,messages}.ts` |
| Message factories | `packages/core` (`createTextMessage`) |
| SDK | `packages/sdk/src/client.ts`, `packages/sdk/src/http.ts` |
| Mobile client | `packages/mqtt-client/src/client.ts`, `packages/api-client/src/` |
| Mobile app | `apps/mobile/src/{stores,contexts,hooks}` |
| Gateway | `packages/agent-gateway/src/gateway.ts`, `state.ts` |
| Agent runtime | `packages/agent-edge/src/{agent,IAgent}.ts` |
| Gateway CLI | `apps/agent-edge-app/src/gateway.ts` |
