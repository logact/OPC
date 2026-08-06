---
'@opc/agent-edge': minor
'@opc/agent-gateway': minor
---

feat: task(goal) 模式为 agent 注入真实执行工具（issue #136）

- `@opc/agent-edge`：新增 `createExecutionTools(workspaceDir, names?)`（tools.ts），
  基于 pi-agent-core 自带 harness 工具（bash/read/write/edit）+ `NodeExecutionEnv`，
  将 trailing context 绑定为 per-agent workspace 后输出普通 `AgentTool`；
  `PiThreadDeps` / `AgentRuntimeDeps` 新增可选 `executionTools` / `workspaceDir`，
  goal 模式工具为 `[complete_task, ...executionTools]`，system prompt 补充工具清单
  与工作目录说明；chat 模式维持无工具。
- `@opc/agent-gateway`：`createDefaultAgent()` 读取 `EDGE_AGENT_TOOLS`
  （默认 `bash,read,write,edit`，逗号裁剪，空字符串表示不注入）与
  `EDGE_AGENT_WORKSPACE`（默认 `~/.opc-gateway/workspaces/<agentId>`，spawn 时
  `mkdir -p`）。

无 wire 协议变更；不配环境变量时行为为默认全套工具，chat 模式行为不变。
