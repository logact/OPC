---
'@opc/agent-edge': minor
'@opc/agent-gateway': minor
---

feat: codex / kimi / claude CLI 注册为 goal/task 模式执行工具（issue #144）

- `@opc/agent-edge`：`ExecutionToolName` 新增 `codex | kimi | claude` 并进入默认
  工具集；新增 CLI 工具工厂（tools.ts）——以非交互 full-access 标志 spawn 对应 CLI
  （`codex exec --dangerously-bypass-approvals-and-sandbox`、`kimi --prompt … --auto`、
  `claude --print --dangerously-skip-permissions`），cwd 锚定 per-agent workspace，
  子进程继承 gateway 环境（API key 走 gateway `.env`），支持 `prompt` / `model` /
  `timeout` 参数，`AbortSignal` 触发 kill（thread pause/terminate），输出截断至
  50k 字符上限。`createExecutionTools` 新增可选 `deps.spawn` 便于测试注入。
- `@opc/agent-gateway`：spawn agent 前按 `<cli> --version` 探测 CLI 可用性
  （`filterUnavailableCliTools`），不可用的跳过并告警而非失败；
  `parseExecutionToolNames` 对未知名字维持 warn-and-ignore，旧版 gateway 前向兼容。

无 wire 协议变更。**风险**：CLI 委托工具以 full-access 运行，workspace 仅锚定
cwd 而非沙箱；chat/question 模式行为不变。
