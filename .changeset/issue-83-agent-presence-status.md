---
'@opc/agent-edge': minor
'@opc/agent-gateway': minor
'@opc/server': minor
'@opc/database': minor
'@opc-pub/agent-edge-app': minor
---

feat: agent 忙闲状态上报与展示（issue #83）

- `@opc/agent-edge`：新增 `AgentActivityStatus` 与纯函数 `deriveAgentActivity`
  （按 working > blocking > error > idle 优先级聚合 thread 状态）；
  `AgentInfo` 新增 `activity` 字段。
- `@opc/agent-gateway`：thread 状态变化时聚合发布 retained presence
  `{online:true, status}`（与上次相同则跳过；重连后补发最近状态）。
  **行为变化**：thread error 不再把 agent 标为 offline——offline 只表达
  连接层不可用（stop / spawn 失败 / gateway 级联），应用层失败以
  `status:'error'` 展示。
- `@opc/server` / `@opc/database`：`participants` 表新增 `status` 列
  （migration 0005），presence 消息中的 status 落库并随 `GET /participants`
  透出；offline 时 status 置 null。
- `@opc-pub/agent-edge-app`：`agents list` / `agents info` 显示 agent 的
  忙闲状态（ACTIVITY 列）。
