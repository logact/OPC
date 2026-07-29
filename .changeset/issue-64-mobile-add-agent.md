---
'@opc/mobile': minor
---

feat(mobile): Add Agent 页面重构为 gateway 创建流程

- 第一步选择 gateway（`GET /participants?kind=gateway`，含加载/空态/刷新，单个 gateway 自动预选）。
- 第二步填写 gateway 创建 agent 所需信息：名称、provider（anthropic/openai/google/deepseek/openrouter）、model id、可选 API key。
- 提交即 `register(kind: 'agent', gatewayId, model)` → 创建单聊房间并进入；移除 endpoint/protocol/capabilities 原型字段与本地 AsyncStorage registry。
- Contacts 分区改为 server 端 `kind`：AI Agents / Gateways / Humans；Me 页 agent 计数改用 server 数据。
- Maestro：更新 08-contacts / 09-add-agent / 90-style flows，新增 `seed-gateway.js`。
