# Mobile UI Redesign — Prototype Analysis & E2E Test Plan (Maestro)

Source prototype: `/Users/logact/projects/OPC/UI/prototype.html` ("OPC IM — Mobile Prototype")

This document is the **review artifact** for the TDD loop: it defines what the new UI
must do (flows), what it must look like (style spec), and how Maestro verifies it
(testID contract + flow inventory). **No implementation code is written until these
tests pass human review.** All flows are expected to fail (red) against the current app.

---

## 1. Prototype analysis

### 1.1 Concept

A dark-themed mobile IM where the address book mixes **humans** and **AI agents
deployed on remote servers**. Agents are first-class contacts: add one by endpoint,
chat 1v1, or pull several into a group and `@mention` to invoke.

### 1.2 Screens

| #   | Screen                 | Prototype id       | Key elements                                                                                                                                                                                        |
| --- | ---------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S0  | Login                  | (current app only) | participant id + password, submit; register-first-account mode toggle (#124)                                                                                                                                                               |
| S1  | Chats (tab)            | `s-chats`          | navbar "OPC IM" + `＋`, search bar, conversation rows (avatar, name, AGENT/REMOTE/+AI tags, time, preview, unread badge), tab bar                                                                   |
| S2  | Contacts (tab)         | `s-contacts`       | search, "AI Agents · remote deployed" section, "Humans" section, rows with mono endpoint, online status                                                                                             |
| S3  | Add Agent (tab)        | `s-addagent`       | hint card, name input, endpoint input, protocol picker (A2A / ACP / WebSocket), capability chips, "Test Connection & Add", Cancel                                                                   |
| S4  | Me (tab)               | `s-me`             | profile card (avatar + did), workspace rows (My Agents, Relay Server, E2E Encryption, Settings)                                                                                                     |
| S5  | New Group              | `s-newgroup`       | back, group name input, member picker (humans + agents mixed, checkbox), Create Group                                                                                                               |
| S6  | Chat Room              | `s-room`           | navbar back + title (group shows member count) + `⋯`, message list (me/other bubbles, who row, AGENT tag, endpoint chip, sys pill, typing indicator), `@` pill, input, Send, mention suggestion box |
| S7  | Room Info              | `s-roominfo`       | members row (+ Invite), settings rows (Notifications, Pinned, Agent Permissions, History Sync)                                                                                                      |
| S8  | Organization (tab)     | issue #113         | recursive department tree, staff/leader/position counts, responsibility summaries                                                                                                                   |
| S9  | Department Detail      | issue #113         | positions, responsibilities, skill/capability grants, human + agent roster, presence                                                                                                                |
| S10 | Organization Forms     | issue #113         | department create/edit/move, position/grant editor, multi-position staff assignments                                                                                                                |
| S11 | Tasks (tab)            | issue #113         | Created, Assigned, Collaborating, Review, and Managed scopes with status filters                                                                                                                    |
| S12 | Task Create/Edit       | issue #113         | department/target pickers, description, required skills, validation                                                                                                                                 |
| S13 | Recommendation/Confirm | issue #113         | scored candidates, availability, skill matches, reasons, explicit role confirmation                                                                                                                 |
| S14 | Task Detail            | issue #113         | people/presence, lifecycle actions, results/transitions/events, task-room progress                                                                                                                  |

Tab bar (S1–S4, S8, S11): **Chats · Contacts · Add Agent · Org · Tasks · Me**, 64px, icons + 10.5px labels,
active tab in accent color.

### 1.3 Flow inventory (each = ≥1 Maestro flow)

| Flow    | Description                                                                                                      | Backend dependency                                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| F1      | Login → lands on Chats tab                                                                                       | existing auth                                                                                                                 |
| F2      | Tab navigation across all 6 tabs                                                                                 | none (client)                                                                                                                 |
| F3      | Chats list renders conversations with tags/unread/preview                                                        | existing rooms API                                                                                                            |
| F4      | Open room → send message → own bubble appears right-aligned with time + ✓✓                                       | existing messages API                                                                                                         |
| F5      | `@` pill / typing `@` opens mention box → pick agent → name inserted                                             | client + members API                                                                                                          |
| F6      | Add Agent: pick gateway → fill model form; validation error toast (empty fields); success → toast + auto-open DM | gateway registration + `kind`/`model` on POST /participants (landed, issue #64)                                               |
| F7      | New Group: validation (no members); pick members → create → lands in new room with system message                | existing rooms API (members)                                                                                                  |
| F8      | Room Info: members row + Invite + settings rows                                                                  | existing members API                                                                                                          |
| F9      | Contacts: AI Agents / Gateways / Humans sections by server-side `kind`                                           | `kind` on participants (landed, issue #64)                                                                                    |
| F10     | Me tab: profile + workspace rows                                                                                 | mostly static client                                                                                                          |
| F12     | Deep organization tree → department detail; humans/agents shown, gateways excluded                               | organization + participants APIs                                                                                              |
| F13     | Authorized department/position/grant/leadership/multi-position management                                        | organization APIs + capabilities                                                                                              |
| F14     | Unauthorized staff cannot discover management actions                                                            | staff profile + capability resolution                                                                                         |
| F15     | Human task create → recommend → confirm → assign → submit → reject → resubmit → approve                          | task + organization APIs                                                                                                      |
| F16     | Agent assignment shows live presence, MQTT execution events, and review readiness                                | live gateway/agent backend                                                                                                    |
| ~~F11~~ | ~~Agent reply with typing indicator after being @mentioned~~                                                     | **removed (issue #79)** — client-side fake replies polluted real chats; a real reply comes from a live remote agent over MQTT |

### 1.4 Gap analysis (current app → prototype)

Current app (`apps/mobile/src`): 3 stack screens (Login / RoomList / Chat), light
theme, no tab bar, no testIDs, Chinese labels.

- **Navigation**: stack → 4-tab root (Chats/Contacts/Add Agent/Me) + stack pushes
  (New Group, Chat Room, Room Info).
- **Theme**: light/default → dark theme (tokens in §2). `app.json`
  `userInterfaceStyle` should become `"dark"`.
- **New screens**: Contacts, Add Agent, Me, New Group, Room Info (5 new).
- **Reworked screens**: RoomList → Chats (tags, unread, preview, search),
  Chat → Chat Room (bubbles, mention box, input bar).
- **Backend gaps** (flagged, NOT part of this mobile-only rewrite unless you decide
  otherwise): agent endpoint/protocol/capabilities storage, online presence,
  agent auto-reply. Flows depending on these are tagged `agent-backend` and are
  expected to stay red until the protocol/server catches up (which per AGENTS.md
  would itself require protocol-first changes + changesets).

---

## 2. Style spec (design tokens extracted from prototype CSS)

### 2.1 Color tokens

| Token         | Value     | Usage                                     |
| ------------- | --------- | ----------------------------------------- |
| `bg`          | `#0b0e14` | screen background                         |
| `panel`       | `#12161f` | navbar, tab bar, input bar, pressed state |
| `panel2`      | `#181e2a` | search, inputs, hint cards, chips         |
| `line`        | `#232b3a` | borders/dividers                          |
| `text`        | `#e8ecf4` | primary text                              |
| `muted`       | `#8a94a8` | secondary text, inactive tabs             |
| `accent`      | `#4f7cff` | primary buttons, links, active tab, send  |
| `accent2`     | `#22c55e` | online dot, success toast                 |
| `agent`       | `#a78bfa` | AGENT tag, capability chips               |
| `remote`      | `#38bdf8` | REMOTE tag, endpoint chips                |
| `bubbleMe`    | `#2b5cff` | own message bubble (no border)            |
| `bubbleOther` | `#1c2331` | peer bubble (1px `line` border)           |
| `danger`      | `#ef4444` | unread badge                              |

### 2.2 Shape & typography

- Avatars: 48px list / 44px member / 36px in-message / 30px mention; radius 14px
  (group 16px); white bold initial or emoji; online dot 13px with 2.5px `bg` ring,
  offline `#5b6478`.
- Bubbles: me → radius `14/4/14/14`, other → `4/14/14/14`; padding 9×12; font 14.5/1.45.
- Navbar: 52px, `panel` bg, bottom border `line`, title 17px/700.
- Tab bar: 64px + safe-area, icon 21px, label 10.5px.
- Conversation row: 12×14 padding, name 15.5/600, time 11.5 muted, preview 13.5 muted single-line ellipsis.
- Tags (AGENT/REMOTE/+AI): 9px/700, letter-spacing .4, radius 4, dark text on colored bg.
- Inputs: `panel2` bg, 1px `line` border, radius 10 (form) / 18 (chat pill), focus border `accent`.
- Primary button: `accent` bg, radius 12, 15px/700. Ghost: transparent, `line` border, muted text.
- Toast: top-center pill, `accent2` bg, dark text, 13px/700, auto-dismiss ~1.6s.
- Mono font (SF Mono/Menlo) for endpoints and dids.

### 2.3 How Maestro "covers style"

Maestro cannot read computed colors/font metrics from native views. Style coverage
is therefore layered:

1. **Structural style assertions (automated, this suite, `style` tag):** every
   style-bearing component gets a stable testID (bubble variants, tags, badges,
   dots, chips, tab bar). `flows/90-style.yaml` asserts their presence/position on
   each screen and captures named screenshots per screen.
2. **Screenshot review (human loop):** the screenshots from (1) are the artifacts
   you review against the prototype each iteration.
3. **Token-level assertions (later, Jest):** exact color/spacing values will be
   pinned by component tests importing a shared `theme.ts` at implementation time
   — also written test-first.

---

## 3. testID contract (implementation must expose these)

Naming: kebab-case, `{id}` = entity id from state.

### Global

`tab-chats`, `tab-contacts`, `tab-addagent`, `tab-org`, `tab-tasks`, `tab-me`, `toast`

### S0 Login

`login-id-input`, `login-password-input`, `login-name-input` (register mode only), `login-submit`, `login-toggle-mode`

### S1 Chats

`chats-title`, `chats-new-group-btn`, `chats-search`, `conv-list`,
`conv-item-{id}`, `conv-avatar-{id}`, `conv-name-{id}`, `conv-time-{id}`,
`conv-preview-{id}`, `conv-tag-agent-{id}`, `conv-tag-remote-{id}`,
`conv-tag-ai-{id}` (group "+AI"), `conv-unread-{id}`

### S2 Contacts

`contacts-search`, `contacts-section-agents`, `contacts-section-gateways`,
`contacts-section-humans`, `contact-item-{id}`, `contact-subtitle-{id}`,
`contact-tag-agent-{id}`, `contact-tag-gateway-{id}`

### S3 Add Agent

`addagent-hint`, `addagent-gateways-refresh`, `addagent-gateways-empty`,
`addagent-gateway-item-{id}`, `addagent-name-input`,
`addagent-provider-{p}` (`anthropic` / `openai` / `google` / `deepseek` / `openrouter`),
`addagent-model-input`, `addagent-apikey-input`, `addagent-submit`, `addagent-cancel`

### S4 Me

`me-profile`, `me-avatar`, `me-name`, `me-endpoint`,
`me-row-agents`, `me-row-relay`, `me-row-e2e`, `me-row-settings`

### S5 New Group

`newgroup-back`, `newgroup-title`, `newgroup-name-input`,
`grouppick-list`, `grouppick-item-{id}`, `grouppick-check-{id}`,
`newgroup-create`

### S6 Chat Room

`room-back`, `room-title`, `room-info-btn`, `msg-list`,
`msg-item-{id}`, `msg-bubble-me-{id}`, `msg-bubble-other-{id}`,
`msg-who-{id}`, `msg-tag-agent-{id}`, `msg-endpoint-chip-{id}`,
`msg-meta-{id}`, `msg-sys-{id}`, `typing-indicator`,

Note: in `msg-who-{id}` / `msg-tag-agent-{id}` the `{id}` is the SENDER's participant id (not the message id), so duplicates are expected when a sender has multiple messages in the list.
`room-at-btn`, `room-intent-toggle`, `room-input`, `room-send-btn`,
`mention-box`, `mention-item-{id}`

### S7 Room Info

`roominfo-back`, `roominfo-title`, `member-row`, `member-{id}`,
`member-invite`, `roominfo-row-notifications`, `roominfo-row-pinned`,
`roominfo-row-agent-perms`, `roominfo-row-history`

### S8 Organization

`screen-org`, `org-tree`, `org-create-department`, `org-node-{id}`,
`org-node-toggle-{id}`, `org-node-staff-count-{id}`, `org-node-leaders-{id}`,
`org-node-positions-{id}`

### S9 Department Detail

`screen-department-detail`, `department-create`, `department-edit`,
`department-move`, `position-create`, `position-item-{id}`,
`department-staff-manage`, `department-staff-{participantId}`,
`department-staff-kind-{participantId}`, `department-staff-presence-{participantId}`,
`department-staff-leader-{participantId}`

### S10 Organization Forms

`department-form-name`, `department-form-parent`, `department-picker-{id}`,
`department-form-submit`, `position-form-name`,
`position-form-responsibility-title`, `position-form-responsibility-description`,
`position-form-skill-tags`, `position-grant-add`, `capability-option-{capability}`
(dots converted to hyphens), `capability-scope-{scope}`, `position-form-submit`,
`staff-picker-{participantId}`, `staff-assignment-add`, `staff-assignment-leader`,
`staff-assignment-submit`

### S11 Tasks

`screen-tasks`, `task-create`, `task-scope-created`, `task-scope-assigned`,
`task-scope-collaborating`, `task-scope-review`, `task-scope-managed`,
`task-status-filter-{status}`, `task-item-{id}`

### S12 Task Create/Edit

`task-form-title`, `task-form-error-title`, `task-form-description`,
`task-form-department`, `task-form-target`, `task-target-type-position`,
`task-target-type-participant`, `task-target-position-{id}`,
`task-target-participant-{id}`, `task-form-skill-tags`, `task-form-submit`

### S13 Recommendation and Assignment Confirmation

`candidate-item-{participantId}`, `candidate-score-{participantId}`,
`candidate-availability-{participantId}`, `candidate-skills-{participantId}`,
`candidate-reasons-{participantId}`, `candidate-presence-{participantId}`,
`candidate-select-{participantId}`, `assignment-collaborators`,
`assignment-reviewer`, `participant-option-{participantId}`, `assignment-review`,
`assignment-confirmation`, `assignment-confirm-assignee-{participantId}`,
`assignment-confirm-collaborator-{participantId}`,
`assignment-confirm-reviewer-{participantId}`, `assignment-confirm-submit`

### S14 Task Detail

`task-status-{status}`, `task-action-assign`, `task-action-start`,
`task-action-block`, `task-action-resume`, `task-action-submit`,
`task-action-edit`, `task-action-approve`, `task-action-reject`, `task-action-cancel`,
`task-block-reason`, `task-block-submit`, `task-resume-reason`,
`task-resume-submit`, `task-result-summary`, `task-result-submit`, `task-reject-feedback`,
`task-reject-submit`, `task-approve-comment`, `task-approve-submit`,
`task-cancel-reason`, `task-cancel-submit`,
`task-person-presence-{participantId}`, `task-execution-progress`,
`task-event-progress`, `task-room-open`

---

## 4. Maestro suite layout

Lives at the repo root (`.maestro/`), decoupled from `apps/mobile`:

```
.maestro/
├── config.yaml              # appId, flow order, tags
├── subflows/
│   ├── login.yaml           # login if logged out
│   ├── seed.yaml            # register extra participants via server HTTP API
│   └── open-first-room.yaml # chats → open first conversation
└── flows/
    ├── 01-login.yaml            F1          tag: smoke
    ├── 02-tab-navigation.yaml   F2          tag: smoke
    ├── 03-chats-list.yaml       F3          tag: smoke
    ├── 04-chat-room-send.yaml   F4          tag: core
    ├── 05-mention-agent.yaml    F5          tag: core
    ├── 06-new-group.yaml        F7          tag: core
    ├── 07-room-info.yaml        F8          tag: core
    ├── 08-contacts.yaml         F9          tag: core
    ├── 09-add-agent.yaml        F6          tag: core
    ├── 10-me.yaml               F10         tag: smoke
    ├── 11-organization-tree.yaml       F12  tag: core
    ├── 12-organization-management.yaml F13  tag: core
    ├── 13-organization-unauthorized.yaml F14 tag: core
    ├── 14-task-human-lifecycle.yaml    F15  tag: core
    ├── 15-task-agent-progress.yaml     F16  tag: agent-backend
    └── 90-style.yaml            style §2.3  tag: style
```

Tags: `smoke` (fast must-pass), `core` (main flows), `style`, `agent-backend`.
The real agent task progress journey carries `agent-backend` and needs a live
`maestro-gateway` with model credentials; CI excludes it. F6/F9 remain `core`
because issue #64 landed participant `kind` + gateway/model registration.
The `simulation` tag is gone: its only flow (F11) was removed
in issue #79 together with the client-side reply simulator.

## 5. Running

Prereqs: [Maestro CLI](https://maestro.mobile.dev) installed, the mobile app
installed on a booted simulator/emulator (from `apps/mobile`: `pnpm dev:mobile`),
server reachable (default `http://localhost:3000`, override with `OPC_SERVER_URL`).

Run from the repo root:

```bash
maestro test .maestro/                          # whole suite
maestro test --include-tags smoke .maestro/     # smoke only
maestro test --exclude-tags agent-backend .maestro/
```

Seeding: `subflows/seed.yaml` registers extra participants (Alice, Ben, Code Bot)
through the server REST API so Chats/New Group/Contacts have data. Flows that need
a gateway (08, 09) additionally run `scripts/seed-gateway.js`, which registers the
`maestro-gateway` participant with `kind: 'gateway'`. Room seed data
(“DevOps Crew” etc.) can be added the same way once member-creation semantics are
confirmed.

Issue #113 flows additionally run `scripts/seed-organization.js`. It creates an
idempotent four-level department hierarchy, positions with responsibilities,
skills and grants, human/agent assignments, a leader, and a gateway-owned task
agent. Authorization is always enforced now, so all seed scripts read an Owner
token from `OPC_OWNER_TOKEN` and perform registrations/organization setup as
the Owner. The Owner is separate from every mobile persona so refreshing its
credentials never invalidates the app session. For local runs, create or obtain
an Owner token and export it alongside `OPC_SERVER_URL`; CI injects it via a
repository secret.

## 5.1 CI gate

`.github/workflows/ci-mobile-e2e.yml` runs this suite on an iOS simulator
(Debug simulator build + Metro on localhost:8081; the simulator shares the host
network, so no port forwarding needed). It is wired
into `ci.yml` as a **required** job (aggregated by the `CI Done` gate) and runs
only when `.maestro/`, `apps/mobile/`, `packages/` or the lockfile change —
it's a heavy job (~30–60 min), so docs-only PRs skip it.

The server is **not** started in CI: the app is pointed at the LAN test server
(192.168.1.51) exposed via frp as `http://120.79.160.188:6001` (HTTP API) and
`ws://120.79.160.188:9001` (MQTT-WS), injected at Metro bundle time via
`EXPO_PUBLIC_OPC_SERVER_BASE_URL` / `EXPO_PUBLIC_OPC_MQTT_BROKER_URL`
(`apps/mobile/src/config/env.ts`). Note: public port 3000 on that host is a
_different_ OPC deployment — do not use it. Caveat: the suite now mutates the
shared test server (registers participants, creates rooms), so avoid running
this job concurrently with manual testing against the same server.

CI currently runs with `--exclude-tags agent-backend`: the live agent execution
flow is intentionally excluded, while all organization and human task flows are
required. The `simulation` tag was removed in issue #79. Screenshots and the
JUnit report are uploaded as the `maestro-results` artifact on every run.

The suite is executed via `.maestro/scripts/run-fail-fast.sh`, which:

1. **Preflight**: checks server (`$OPC_SERVER_URL/openapi.json`, in CI the
   frp-exposed test server), MQTT-WS (`$MQTT_WS_HOST:$MQTT_WS_PORT`) and local
   Metro (8081) reachability before running, so an infrastructure outage
   fails fast with an "environment failure" annotation instead of misleading
   flow assertions.
2. **Fail-fast**: runs flows one by one in filename order, each producing its
   own JUnit report (`maestro-results/<flow>.xml`). The first failing flow
   fails the whole job immediately — no retry rounds, no running the rest.

The CI job also caches CocoaPods / Xcode DerivedData / the Maestro CLI install
between runs, boots the simulator asynchronously (in parallel with the Xcode
build), and disables simulator animations (`UIAnimationDragCoefficient`) to
cut tap latency and cold-start flakes.

## 6. Open questions for review

1. **Agent data model**: ~~agent endpoint/protocol/capabilities don't exist in
   `packages/protocol`~~ **Resolved (issue #64)**: neither A nor B as originally
   framed — agents are spawned by a registered **gateway**; the app passes
   `kind: 'agent'` + `gatewayId` + `model` (provider/modelId/apiKey) on
   `POST /participants`, and the endpoint/protocol/capabilities concept was
   dropped together with the on-device registry (`src/agents/registry.ts`).
2. **Agent reply simulation (F11)**: ~~prototype fakes replies client-side.~~
   **Resolved (issue #79)**: the client-side simulator was removed — it posted
   canned "Received…/Done…" replies into real rooms, drowning out the agent's
   real reply. Agent replies now only come from a live remote agent over MQTT;
   flow `11-agent-reply` was dropped.
3. **Online presence dots**: no presence API exists. Show static/optimistic state
   for now?
4. **Localization**: current app is Chinese, prototype is English. Tests assert
   the prototype's English copy ("Chats", "Send", "Add Remote Agent"…). Confirm
   the redesign switches to English.
5. **Me tab rows** (Relay Server, E2E Encryption…) are static in the prototype —
   assert presence only, or wire to real state later?
