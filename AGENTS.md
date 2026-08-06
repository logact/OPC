OPC Monorepo 代理指南

本仓库是 OPC 的统一 monorepo，包含 server、mobile client 以及共享的协议与 SDK 包。

.
├── apps/
│   ├── server/            # 主 IM server（HTTP 管理面 + MQTT 数据面 bridge）
│   ├── agent-edge-app/    # @opc-pub/agent-edge-app：gateway CLI（npm install -g 后可用 opc-gateway）
│   └── mobile/            # React Native 移动端
├── packages/
│   ├── core/              # server 内部领域工厂函数
│   ├── database/          # Drizzle ORM schema / client / migrations
│   ├── protocol/          # 通信协议定义（topic 约定 + payload schema + HTTP 路由）
│   ├── sdk/               # 客户端 SDK（mqtt.js）
│   ├── agent-edge/        # 边缘设备上的轻量 agent runtime（基于 pi-agent-core）
│   ├── agent-gateway/     # 边缘机器上的 gateway：多路复用 agent、转发 MQTT 消息
│   ├── api-client/        # mobile HTTP API client
│   └── mqtt-client/       # mobile MQTT client
└── pnpm-workspace.yaml

API 契约：唯一事实来源

packages/protocol 是 OPC 整个生态（server + mobile）的唯一 API 契约来源。以下所有内容必须在此定义：





HTTP 路由路径（API_ROUTES）



请求 / 响应 Zod schemas



MQTT topic 约定（MQTT_TOPICS）与上下行负载类型



核心领域模型类型（Room、Participant、Message、ServerEvent 等）

修改接口的强制顺序

当需求涉及 HTTP API、MQTT 负载或核心模型变更时，必须按以下顺序修改：





packages/protocol/src/：更新 schema、route、type。



apps/server/src/：基于新的 protocol 实现 handler。



packages/api-client/ 与 packages/mqtt-client/：基于新的 protocol 调整客户端调用。



运行验证命令（见下方）。

禁止事项





禁止在 apps/server/src/server.ts 或其他 handler 中内联定义 Zod schema 或 TypeScript 类型。



禁止在 server 层写死路径字符串，所有路径必须从 @logact-pub/opc-protocol 的 API_ROUTES 导入。



禁止在 packages/core 或其他包中重复定义领域模型类型；Room、Participant、Message、ServerEvent 等类型只能通过修改 packages/protocol 的 Zod schema 变更（TS 类型由 schema 推导，见 packages/protocol/src/wire.ts）。packages/core 仅保留 server 内部的工厂函数（如 createTextMessage）。



禁止在 mobile 端手写与 @logact-pub/opc-protocol 重复的 schema 或类型。

Agent Gateway 控制面约定





管理面：POST /api/v1/participants { id, kind: 'agent', gatewayId } 注册 agent participant；server 注册成功后向 opc/gateways/{gatewayId}/control 下发 agent.spawn 命令（不再携带 agent token——单连接模型下 agent 无需独立 MQTT 凭据；protocol 中该字段为可选兼容层）。



控制 topic：opc/gateways/{gatewayId}/control，仅 gateway 自身可 SUBSCRIBE（ACL：username == gatewayId，acc 为 READ/SUBSCRIBE/READWRITE）。



数据面（单连接多路复用，issue #80）：每台机器上的 gateway 以一条 MQTT 连接承载本机所有 agent 的消息收发：





下行：server 把房间事件 fan-out 到房间内每个 agent 成员的 opc/agents/{agentId}/events；gateway 订阅其名下每个 agent 的该 topic（ACL：仅归属 gateway 可订阅），按 agentId 路由到对应 agent runtime。



上行：agent runtime 经 IAgent.onMessage 回调把回复交给 gateway，由 gateway 统一 PUBLISH 到 opc/participants/{agentId}/rooms/{roomId}/uplink（ACL 放行"gateway 名下 agent 是该房间成员"）。from 字段已废弃，发送者以 topic 中的 participantId 为准。



presence：agent 不再有独立 MQTT 连接，其 presence 由 gateway 按 runtime 真实状态上报（ACL 允许 gateway 写名下 agent 的 presence topic）。presence 负载为 { online, status? }（issue #83）：online 表达连接层可用性（spawn 成功 online；spawn 失败 / stop 置 offline；gateway 异常断线时 server 级联将其名下所有 agent 置 offline 并覆写 retained presence）；status 表达应用层忙闲——gateway 订阅 runtime 的 onStatusChange，按 working > blocking > error > idle 优先级聚合所有 thread 状态后发布（AgentInfo.activity / deriveAgentActivity，见 packages/agent-edge）。thread error 不再标 offline，而是以 status:'error' 展示。展示层按 !online → offline; online → status ?? 'idle' 合成 5 态。



离线补投（issue #84）：离线期间发给 agent 的消息不丢失，三层互补机制——





MQTT 持久会话：gateway 与 server bridge 均以固定 clientId + clean: false 连接，断线期间 broker 为其订阅排队 QoS1 消息（上限见 docker/mosquitto/mosquitto.conf 的 max_queued_messages），重连后补收；



spawn 重发：server 在收到 gateway 的 online presence 时，按注册时持久化在 participant.metadata.spawn 的参数重发其名下所有 agent 的 agent.spawn（gateway 侧 spawn 幂等），覆盖 gateway 进程重启场景；



水位补投：gateway 在 spawn / 重连后按 SQLite（node:sqlite）持久化的 per-agent-per-room 水位游标，经 GET /api/v1/participants/{id}/rooms + GET /api/v1/rooms/{id}/history?since=<水位> 增量拉取历史并回放给 runtime；水位同时对 broker 队列与 HTTP 拉取的重叠消息幂等去重。history 读取的授权按委托模式判定：requester 为 gateway 且非房间成员时，server 评估房间内归属该 gateway 的 agent 的 message.read 能力（与 uplink ACL 同一模式）；自 issue #126 起房间成员关系本身即满足 message.read / message.send，agent 无需再经 position 授予 message.* capability。



gateway 自管理（spec #70 modelCatalog 自上报等）：gateway 无 staff position（#115），永远拿不到 participant.* capability grant；server 放行 gateway 读取（GET/list）与更新（PATCH）自身 participant 记录，但不允许借此变更自身 kind（403）。

Agent Gateway 安装与运行

@opc-pub/agent-edge-app 发布到 npm registry，边缘机器可直接安装 CLI：

npm install -g @opc-pub/agent-edge-app
opc-gateway start

环境变量（也可写入 .env 后由 node --env-file 加载）：

- `EDGE_GATEWAY_ID` — gateway participant id（默认 `gw-<hostname>-<pid>`）
- `EDGE_GATEWAY_TOKEN` — MQTT/HTTP token；**必填**，需先用 owner 凭据经 `POST /api/v1/participants`（`kind: 'gateway'`）预注册后填入。未鉴权的 gateway 自助注册已不可用：open door 首个人类注册在 issue #122 后默认关闭（仅 `OPC_ALLOW_OPEN_BOOTSTRAP=true` 时放行，见下文），且非 human 的注册始终要求鉴权。
- `OPC_SERVER_URL` — OPC HTTP server（默认 `http://localhost:3000`）
- `OPC_BROKER_URL` — MQTT broker（默认 `mqtt://localhost:1883`）
- `EDGE_MODEL_PROVIDER` / `EDGE_MODEL_ID` / `EDGE_MODEL_API_KEY` — LLM 配置
- `EDGE_ADMIN_HOST` / `EDGE_ADMIN_PORT` — 本机 admin server 监听地址（默认 `127.0.0.1:4646`，无鉴权，只应绑定 loopback）
- `EDGE_STATE_DB` — SQLite 状态库路径（离线补投水位持久化，默认 `~/.opc-gateway/state.db`）
- `EDGE_AGENT_TOOLS` — goal/task 模式注入 agent 的执行工具集，逗号分隔（默认 `bash,read,write,edit`；设为空字符串则不注入；chat/question 模式始终无工具）
- `EDGE_AGENT_WORKSPACE` — agent 执行工具的工作目录（默认 `~/.opc-gateway/workspaces/<agentId>`，spawn 时自动 `mkdir -p`；工具相对路径解析到该目录——仅锚定 cwd，非沙箱）
- `EDGE_LOG_LEVEL` — 日志级别：`debug` | `info` | `warn` | `error`（默认 `info`）

生产部署建议预注册 gateway 并固定 EDGE_GATEWAY_TOKEN，避免重启后 token 轮换。

管理命令

opc-gateway start 会在本机 loopback 上启动 admin server，CLI 其余子命令通过它查询/管理正在运行的 gateway：

opc-gateway status                              # gateway 信息：id、server/broker、uptime、MQTT 连接、agent 数
opc-gateway agents list                         # 列出运行中的 agent（lifecycle 状态、忙闲 activity、thread 数）
opc-gateway agents info <id>                    # 单个 agent 详情
opc-gateway agents spawn <id>                   # 走 server 管理面注册 agent（需 EDGE_GATEWAY_ID），gateway 随即 spawn
opc-gateway agents stop <id>                    # 停止 gateway 上的某个 agent
opc-gateway threads list [--agent <id>]         # 列出 threads（含所属 room）
opc-gateway threads history <agentId> <threadId>  # 查看 thread 消息记录
opc-gateway repl                                  # 交互式 shell：直接输入上述命令（不带 opc-gateway 前缀），exit 退出

threads 与 agent 运行时状态只存在于 gateway 进程内存中，进程重启后不可恢复；server 侧只有 rooms/messages，无 thread 概念。

Server 首个 owner bootstrap（issue #122）

server 启动（监听前）支持从环境变量声明式种子首个 org owner：





OPC_BOOTSTRAP_OWNER_ID + OPC_BOOTSTRAP_OWNER_PASSWORD — 必须同时设置，只设一个启动即失败；仅在库中尚无 owner 时生效（幂等，owner 已存在则忽略并打 warning，绝不重置现有 owner 密码）。



OPC_ALLOW_OPEN_BOOTSTRAP=true — 显式打开未鉴权的首个人类注册（open door，POST /api/v1/participants with kind: 'human'）。默认关闭；仅 dev/e2e 场景使用，生产应改用上面的 env 种子。env 未设置且库中无 owner 时 server 仍会启动并打 warning。

变更验证

修改 protocol、server 或 mobile 消费端后，必须运行：

# 类型检查
pnpm typecheck

# 单元测试
pnpm test

# HTTP + MQTT 端到端测试（需 PostgreSQL 与 Mosquitto）
pnpm test:e2e

# mobile 测试
pnpm test:mobile

# mobile UI e2e（Maestro，套件在仓库根目录 .maestro/）
maestro test .maestro/

ci.yml 中的 Mobile E2E (Maestro) job 是必过门禁：当 .maestro/、apps/mobile/、packages/ 或 lockfile 变更时，CI 会在 iOS simulator 上构建 app 并运行 .maestro/ 套件（当前排除 agent-backend 标签；simulation 标签已随 issue #79 移除，见 .maestro/README.md §6）。

E2E 测试约定

apps/server/e2e/ 的功能测试必须以 @logact-pub/opc-sdk 为客户端入口驱动被测 server（管理面 OpcHttpClient，实时面 OpcClient），与 mobile 的实际消费路径一致。唯一例外是 contract.test.ts：它校验 wire 级 schema，故意直接使用原始 HTTP/MQTT。

运行时校验

packages/api-client 必须在收到 HTTP 响应后，用 @logact-pub/opc-protocol 中对应的 Zod schema 做运行时解析校验，不能只做 TypeScript 类型断言。

import { CreateRoomResponseSchema } from '@logact-pub/opc-protocol';

const data = await res.json();
return CreateRoomResponseSchema.parse(data);

破坏性变更与版本管理

本 monorepo 采用统一版本号（根 package.json 的 version），任何需要发版的变更都通过 changeset 标注。

任何修改若满足以下任一条件，必须通过 changeset 标注 @logact-pub/opc-protocol：





删除或重命名已有字段



改变已有字段的类型 / 校验规则



改变已有路由的 path / method



改变 MQTT topic 结构或上下行负载格式

pnpm changeset
# 选择 @logact-pub/opc-protocol 的变更级别：patch / minor / major
```

### 破坏性变更标准流程

1. 在 `packages/protocol/src/` 中修改 schema / route / type。
2. 给 `@logact-pub/opc-protocol` 打 `major` changeset，并在文件中写明：
   - 破坏点是什么
   - 消费方如何迁移
   - 兼容层保留多久
3. 在 `apps/server/src/server.ts` 中实现新协议，并**保留对旧字段/旧路由的兼容层**（字段别名、旧 schema fallback 等）。
4. 在同仓库修改 `packages/api-client`、`packages/mqtt-client`、`apps/mobile` 适配新协议。
5. 等 mobile 端适配合并到 `main` 后，再在后续版本中移除 server 兼容层。

### 禁止事项

- **禁止**未打 major changeset 就做破坏性变更。
- **禁止** major changeset 中不写迁移说明。
- **禁止**在移除兼容层前不确认所有消费方已升级。

## 发布

`@logact-pub/opc-protocol` 与 `@logact-pub/opc-sdk` 发布到 npm registry（`https://registry.npmjs.org`）。发布需要仓库设置 `NPM_TOKEN` secret。

`@logact-pub/opc-core` 是 server 内部包（`private: true`），**不再发布**——它只保留 server 侧工厂函数，领域类型已统一归 `packages/protocol` 所有。npm 上现存的 `opc-core@0.0.2` 为历史版本，消费方不应新增对它的依赖。

### Release 流程

1. 手动触发 `.github/workflows/release.yml`。
2. 它在 `main` 上执行 `pnpm changeset version`，消费累积的 changesets。
3. 同步根 `package.json` 版本，创建 `release/vX.Y.Z` 分支并推送。
4. 创建 Release PR，等待人工审核合并。
5. PR 合并到 `main` 后，`.github/workflows/tag-release.yml` 自动打 tag、发布 npm、创建 GitHub Release。
6. tag push 自动触发 CI，构建并推送 Docker 镜像（version + latest）。

另有两条自动部署链路（`.github/workflows/deploy-*-on-*.yml`，均通过触发 `Deploy to Environment` workflow 实现）：

- main 分支 push 且 CI 成功后，自动把该 commit 的镜像（`sha-<commit>` tag）部署到 **staging** 环境（issue #142）。
- version tag 的 CI 成功后，自动部署到 **development** 环境。

## 开发环境

- 测试服务器地址：`http://192.168.1.51:3000`
- OpenAPI 文档：`http://192.168.1.51:3000/openapi.json`
- MQTT 代理：`mqtt://192.168.1.51:1883`（server bridge / Node 客户端）
- MQTT WebSocket：`ws://192.168.1.51:9001`（mobile app；RN 端 mqtt.js 只有 WS 传输）

本地开发可通过 apps/mobile/.env 覆盖。

常用脚本

pnpm dev          # 启动 server 开发
pnpm dev:mobile   # 启动 mobile Expo
pnpm build        # 构建所有包
pnpm test         # 运行单元测试
pnpm test:e2e     # 运行 E2E 测试
pnpm test:mobile  # 运行 mobile 测试
pnpm lint         # 代码检查
pnpm typecheck    # TypeScript 类型检查

important


this branch (issue-121-test) is a test branch
we will test the code by merge the latest main branch here .
we will review the code here.

we will talk the plan to fix the bug here
we will talk the plan to adjust the feature here
but you must not change any  code here 
any bug ,feat adjustment, new feature should be bind to a new issue on github.


