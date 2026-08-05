---
'@opc/server': minor
'@opc/agent-gateway': patch
'@opc/mobile': minor
---

feat: 聊天页 task 模式创建真实任务并渲染任务卡片（issue #129）

- `@opc/server`：`POST /api/v1/tasks` 支持 `originRoomId`（需搭配 `assigneeId`）。
  校验 creator / assignee 均为 origin 房间成员后，在创建即指派的同一事务内
  往 origin 房间写一条任务卡片消息（`metadata.opcTask.kind = 'reference'`），
  并随 `message.delivered` 事件 fan-out。
- `@opc/agent-gateway`：忽略所有非 `assignment` 的 `opcTask` 消息
  （`reply` / `reference` 等），不再为其创建聊天 thread。
- `@opc/mobile`：1:1 agent 房间的 task 模式改为调用 tasks API 创建并指派真实
  任务（注册进 Task Center），标题取消息首行（80 字符截断）、描述为全文；
  新增 `TaskCard` 组件，聊天流中的任务卡片消息渲染为标题 / 描述 / 状态卡片，
  点击跳转 `TaskDetail`。房间无 agent（或多 agent）时保持旧的 intent 标注行为。
