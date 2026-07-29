---
'@opc/agent-gateway': minor
'@opc-pub/agent-edge-app': minor
---

feat(agent-gateway, agent-edge-app): gateway 本地 admin server 与 `opc-gateway` 管理命令

- `@opc/agent-gateway`:
  - `AgentGatewayOptions` 新增可选 `admin: { host?, port? }`；提供后 `start()` 会在 loopback 上启动 admin HTTP server（无鉴权，只应绑定 127.0.0.1），`stop()` 时关闭。
  - 端点：`GET /status`、`GET /agents`、`GET /agents/:id`、`DELETE /agents/:id`、`GET /agents/:id/threads`、`GET /agents/:id/threads/:threadId/messages`。
  - 新增 `adminAddress()` 诊断方法与 `AdminStatus` / `AdminAgentEntry` / `AdminThreadEntry` 导出类型。
- `@opc-pub/agent-edge-app`:
  - `opc-gateway start` 默认在 `127.0.0.1:4646` 启动 admin server（`EDGE_ADMIN_HOST` / `EDGE_ADMIN_PORT` 可覆盖）。
  - CLI 新增管理子命令：`status`、`agents list|info|spawn|stop`、`threads list [--agent <id>]`、`threads history <agentId> <threadId>`，以及交互式 `repl` 模式。

均为纯新增，向后兼容。
