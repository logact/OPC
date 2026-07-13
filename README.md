# OPC Server

一个基础 IM server 原型。当前只保留核心 IM 功能：房间、消息、订阅、投递。

## 设计原则

- **Participant 抽象**：通信实体统一抽象为 `Participant`，当前 focus 在 human 用户，但协议层不假设发送者类型。
- **统一消息模型**：消息只携带 `from`、`roomId`、`content`、`metadata`。
- **统一接入协议**：所有客户端使用同一套 WebSocket 帧与 HTTP API。
- **Server 无偏好**：路由、投递、历史查询逻辑对任何 participant 一致。

## Workspace 结构

```
.
├── apps/
│   └── server/            # 主 IM server（WebSocket + HTTP）
├── packages/
│   ├── core/              # 领域模型、类型、事件基元
│   ├── database/          # Drizzle ORM schema / client / repositories / migrations
│   ├── protocol/          # 通信协议定义（schema + wire format）
│   └── sdk/               # 客户端 SDK
└── pnpm-workspace.yaml
```

## 快速开始

### 1. 启动 PostgreSQL

```bash
docker compose up -d
```

或自行准备 PostgreSQL，数据库名为 `opc`。

### 2. 配置环境变量

```bash
export DATABASE_URL="postgres://opc:opc@localhost:5432/opc"
export PORT=3000
```

### 3. 执行迁移

```bash
cd packages/database
pnpm db:migrate
```

### 4. 启动服务

```bash
pnpm dev
```

Server 默认监听 `http://localhost:3000`，提供：

- `POST /api/v1/rooms`
- `GET /api/v1/rooms`
- `GET /api/v1/rooms/:id/history`
- `WS /ws/v1`

## 数据库脚本（packages/database）

- `pnpm db:generate` - 先构建 schema 再生成迁移 SQL
- `pnpm db:migrate` - 执行未应用的迁移
- `pnpm db:push` - 直接同步 schema 到数据库（开发用）
- `pnpm db:studio` - 启动 Drizzle Studio 可视化查看数据

## 常用脚本

- `pnpm build` - 构建所有包
- `pnpm test` - 运行单元测试
- `pnpm test:e2e` - 运行 E2E 测试（需先启动 PostgreSQL）
- `pnpm lint` - 代码检查
- `pnpm typecheck` - TypeScript 类型检查

## E2E 测试

E2E 测试会启动真实 OPC server 并连接 PostgreSQL：

```bash
docker compose up -d
pnpm test:e2e
```

CI 中会自动启动 PostgreSQL 16 service container 并运行 `pnpm test` + `pnpm test:e2e`。

## 分支与发布流程

本仓库采用 develop → release → master 的分支模型：`master` 为稳定发布分支，push 到 `master` 会自动打 tag、创建 GitHub Release 并推送 `latest` Docker 镜像。详见 [.github/DEVELOPMENT_GUIDE.md](.github/DEVELOPMENT_GUIDE.md)。