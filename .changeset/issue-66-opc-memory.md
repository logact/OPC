---
'@opc/memory': minor
'@opc/agent-edge': minor
'@opc/agent-gateway': minor
---

feat: add durable, scope-isolated agent memory (issue #66)

- Add `@opc/memory`, a dependency-free memory manager with pluggable storage,
  deterministic lexical recall, TTL expiry, retention limits, and safe model
  prompt formatting for untrusted historical text.
- Agent runtimes remember their thread goals and inbound/outbound messages,
  then inject only relevant memories from their own scope into new threads.
- Gateway memory is persisted in its existing SQLite state database, so managed
  agents retain relevant context across gateway restarts without a wire-protocol change.
