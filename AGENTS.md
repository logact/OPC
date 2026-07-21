# OPC Monorepo 代理指南

本仓库是 OPC 的统一 monorepo，包含 server、mobile client 以及共享的协议与 SDK 包。

```
.
├── apps/
│   ├── server/            # 主 IM server（HTTP 管理面 + MQTT 数据面 bridge）
│   └── mobile/            # React Native 移动端
├── packages/
│   ├── core/              # server 内部领域工厂函数
│   ├── database/          # Drizzle ORM schema / client / migrations
│   ├── protocol/          # 通信协议定义（topic 约定 + payload schema + HTTP 路由）
│   ├── sdk/               # 客户端 SDK（mqtt.js）
│   ├── api-client/        # mobile HTTP API client
│   └── mqtt-client/       # mobile MQTT client
└── pnpm-workspace.yaml
```

## API 契约：唯一事实来源

`packages/protocol` 是 OPC 整个生态（server + mobile）的**唯一 API 契约来源**。以下所有内容必须在此定义：

- HTTP 路由路径（`API_ROUTES`）
- 请求 / 响应 Zod schemas
- MQTT topic 约定（`MQTT_TOPICS`）与上下行负载类型
- 核心领域模型类型（`Room`、`Participant`、`Message`、`ServerEvent` 等）

## 修改接口的强制顺序

当需求涉及 HTTP API、MQTT 负载或核心模型变更时，必须按以下顺序修改：

1. **`packages/protocol/src/`**：更新 schema、route、type。
2. **`apps/server/src/`**：基于新的 protocol 实现 handler。
3. **`packages/api-client/`** 与 **`packages/mqtt-client/`**：基于新的 protocol 调整客户端调用。
4. 运行验证命令（见下方）。

## 禁止事项

- **禁止**在 `apps/server/src/server.ts` 或其他 handler 中内联定义 Zod schema 或 TypeScript 类型。
- **禁止**在 server 层写死路径字符串，所有路径必须从 `@logact-pub/opc-protocol` 的 `API_ROUTES` 导入。
- **禁止**在 `packages/core` 或其他包中重复定义领域模型类型；`Room`、`Participant`、`Message`、`ServerEvent` 等类型只能通过修改 `packages/protocol` 的 Zod schema 变更（TS 类型由 schema 推导，见 `packages/protocol/src/wire.ts`）。`packages/core` 仅保留 server 内部的工厂函数（如 `createTextMessage`）。
- **禁止**在 mobile 端手写与 `@logact-pub/opc-protocol` 重复的 schema 或类型。

## 变更验证

修改 protocol、server 或 mobile 消费端后，必须运行：

```bash
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
```

`ci.yml` 中的 `Mobile E2E (Maestro)` job 是必过门禁：当 `.maestro/`、`apps/mobile/`、`packages/` 或 lockfile 变更时，CI 会在 iOS simulator 上构建 app 并运行 `.maestro/` 套件（当前排除 `simulation` 与 `agent-backend` 标签，见 `.maestro/README.md` §6）。

### E2E 测试约定

`apps/server/e2e/` 的功能测试必须以 `@logact-pub/opc-sdk` 为客户端入口驱动被测 server（管理面 `OpcHttpClient`，实时面 `OpcClient`），与 mobile 的实际消费路径一致。唯一例外是 `contract.test.ts`：它校验 wire 级 schema，故意直接使用原始 HTTP/MQTT。

### 运行时校验

`packages/api-client` 必须在收到 HTTP 响应后，用 `@logact-pub/opc-protocol` 中对应的 Zod schema 做运行时解析校验，不能只做 TypeScript 类型断言。

```ts
import { CreateRoomResponseSchema } from '@logact-pub/opc-protocol';

const data = await res.json();
return CreateRoomResponseSchema.parse(data);
```

## 破坏性变更与版本管理

本 monorepo 采用统一版本号（根 `package.json` 的 `version`），任何需要发版的变更都通过 changeset 标注。

任何修改若满足以下任一条件，必须通过 changeset 标注 `@logact-pub/opc-protocol`：

- 删除或重命名已有字段
- 改变已有字段的类型 / 校验规则
- 改变已有路由的 path / method
- 改变 MQTT topic 结构或上下行负载格式

```bash
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

## 开发环境

- 测试服务器地址：`http://192.168.1.51:3000`
- OpenAPI 文档：`http://192.168.1.51:3000/openapi.json`
- MQTT 代理：`mqtt://192.168.1.51:1883`

本地开发可通过 `apps/mobile/.env` 覆盖。

## 常用脚本

```bash
pnpm dev          # 启动 server 开发
pnpm dev:mobile   # 启动 mobile Expo
pnpm build        # 构建所有包
pnpm test         # 运行单元测试
pnpm test:e2e     # 运行 E2E 测试
pnpm test:mobile  # 运行 mobile 测试
pnpm lint         # 代码检查
pnpm typecheck    # TypeScript 类型检查
```
