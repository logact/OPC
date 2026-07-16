# OPC Server 项目代理指南

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
3. **`../OPC-mobile/packages/api-client/`** 与 **`../OPC-mobile/packages/mqtt-client/`**：基于新的 protocol 调整客户端调用。
4. 运行验证命令（见下方）。

## 禁止事项

- **禁止**在 `apps/server/src/server.ts` 或其他 handler 中内联定义 Zod schema 或 TypeScript 类型。
- **禁止**在 server 层写死路径字符串，所有路径必须从 `@logact-pub/opc-protocol` 的 `API_ROUTES` 导入。
- **禁止**在 `packages/core` 或其他包中重复定义领域模型类型；`Room`、`Participant`、`Message`、`ServerEvent` 等类型只能通过修改 `packages/protocol` 的 Zod schema 变更（TS 类型由 schema 推导，见 `packages/protocol/src/wire.ts`）。`packages/core` 仅保留 server 内部的工厂函数（如 `createTextMessage`）。

## 变更验证

修改 protocol 或 server 接口后，必须运行：

```bash
# 类型检查
pnpm typecheck

# 单元测试
pnpm test

# HTTP + MQTT 端到端测试
pnpm test:e2e
```

### E2E 测试约定

`apps/server/e2e/` 的功能测试必须以 `@logact-pub/opc-sdk` 为客户端入口驱动被测 server（管理面 `OpcHttpClient`，实时面 `OpcClient`），与 mobile 的实际消费路径一致。唯一例外是 `contract.test.ts`：它校验 wire 级 schema，故意直接使用原始 HTTP/MQTT。

如果修改影响了 mobile 消费端，必须同时在 `../OPC-mobile` 仓库运行：

```bash
pnpm typecheck
pnpm test
```

## 破坏性变更与版本管理

任何修改若满足以下任一条件，必须通过 changeset 标注：

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
4. 创建 `../OPC-mobile` 的适配 PR，升级 `@logact-pub/opc-protocol` 版本并修复调用代码。
5. 等 mobile 适配 PR 合并后，再在 server 后续版本中移除兼容层。

### 禁止事项

- **禁止**未打 major changeset 就做破坏性变更。
- **禁止** major changeset 中不写迁移说明。
- **禁止**在移除兼容层前不确认所有消费方已升级。

`@logact-pub/opc-protocol` 与 `@logact-pub/opc-sdk` 发布到 npm registry（`https://registry.npmjs.org`）。移动端通过 `packages/api-client` 和 `packages/mqtt-client` 的 dependencies 按版本号引用，不再默认追 `file:` 最新。发布需要仓库设置 `NPM_TOKEN` secret。

`@logact-pub/opc-core` 是 server 内部包（`private: true`），**不再发布**——它只保留 server 侧工厂函数，领域类型已统一归 `packages/protocol` 所有。npm 上现存的 `opc-core@0.0.2` 为历史版本，消费方不应新增对它的依赖。

## 跨仓库协作

移动端代理指南见 `../OPC-mobile/AGENTS.md`。
