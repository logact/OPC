# OPC Server

一个基础 IM server 原型。实时通讯基于 MQTT（Mosquitto broker），Node.js server 作为群组数据中心：校验、落库（PostgreSQL）、事件转发，并作为 broker 的唯一授权数据源。

## 架构

```
客户端 ──MQTT CONNECT(username=participantId, password=token)──▶ broker
   │                                                              │ 认证/ACL 回调
   │                                          broker ──HTTP──▶ server /api/v1/auth/mqtt/{user,acl}
   │                                                              │ 查 PostgreSQL 判定
客户端 ──PUBLISH──▶ opc/rooms/{roomId}/uplink ──▶ broker ──▶ server（订阅 opc/rooms/+/uplink）
                                                          server: 校验 → 落库 → PUBLISH 到 events topic
客户端 ◀──SUBSCRIBE── opc/rooms/{roomId}/events ◀── broker ◀──┘
```

- 客户端与服务端不直接相连：双方都是 broker 的 MQTT 客户端，通过 topic 解耦
- 消息链路：客户端 → uplink topic → server 落库 → server 转发到 events topic（先落库再投递，server 为权威数据源）
- 管理操作（建房间、历史查询、注册参与者）走 server 的 HTTP API

## 设计原则

- **Participant 抽象**：通信实体统一抽象为 `Participant`，当前 focus 在 human 用户，但协议层不假设发送者类型。
- **统一消息模型**：消息只携带 `from`、`roomId`、`content`、`metadata`。
- **统一接入协议**：所有客户端使用同一套 MQTT topic 约定与 HTTP API。
- **Server 无偏好**：路由、投递、历史查询逻辑对任何 participant 一致。

## Topic 约定

| Topic | 方向 | QoS | 说明 |
|---|---|---|---|
| `opc/rooms/{roomId}/uplink` | 客户端 → server | 1 | 客户端发消息，server 订阅 `opc/rooms/+/uplink` 接收 |
| `opc/rooms/{roomId}/events` | server → 客户端 | 1 | server 落库后发布 `message.delivered` 等 `ServerEvent` |

上行负载（JSON）：

```json
{ "from": "alice", "content": { "type": "text", "body": "hi" }, "clientMessageId": "可选" }
```

下行负载直接是 `@opc/core` 的 `ServerEvent`（含服务端生成的消息 id 与时间戳）。

## 授权

broker 集成 [mosquitto-go-auth](https://github.com/iegomez/mosquitto-go-auth) 插件，认证与授权全部通过 HTTP 回调 server 判定：

- **认证（CONNECT）**：先 `POST /api/v1/participants {id}` 注册，server 生成 token（SHA-256 哈希存 PostgreSQL，明文仅此一次返回）；客户端以 `username=participantId, password=token` 连接
- **授权（PUB/SUB）**：每次发布/订阅触发 ACL 回调，server 查 `room_members`——**只有房间成员**能 publish 该房间 uplink、subscribe 该房间 events，成员隔离在 broker 层强制
- **superuser**：server 自身的 MQTT 连接身份（`MQTT_SERVER_USERNAME`/`MQTT_SERVER_PASSWORD`），跳过 ACL（需订阅通配 uplink、向任意 events 发布）

**已知限制（原型姿态）**：注册端点与 HTTP 管理面本身不鉴权；token 无过期与吊销机制；mosquitto-go-auth 上游已于 2025-06 归档（停更，当前可用）。

**语义变化**：投递目标为「房间成员且订阅了 events topic」的客户端；MQTT at-least-once 语义下客户端可能收到重复事件（可用 `message.id` 去重）。

## Workspace 结构

```
.
├── apps/
│   └── server/            # 主 IM server（HTTP 管理面 + MQTT 数据面 bridge）
├── docker/
│   └── mosquitto/         # broker 镜像（mosquitto + go-auth 插件）与配置
├── packages/
│   ├── core/              # 领域模型、类型、事件基元
│   ├── database/          # Drizzle ORM schema / client / repositories / migrations
│   ├── protocol/          # 通信协议定义（topic 约定 + payload schema + HTTP 路由）
│   └── sdk/               # 客户端 SDK（mqtt.js）
└── pnpm-workspace.yaml
```

## 快速开始

### 1. 启动 PostgreSQL 与 Mosquitto

```bash
docker compose up -d --build
```

首次启动会构建 mosquitto 镜像（编译 go-auth 插件，需几分钟）。

### 2. 配置环境变量

```bash
export DATABASE_URL="postgres://opc:opc@localhost:5432/opc"
export MQTT_BROKER_URL="mqtt://localhost:1883"
export MQTT_SERVER_USERNAME="__server__"
export MQTT_SERVER_PASSWORD="<broker superuser 密码>"
export PORT=3000
```

`MQTT_SERVER_PASSWORD` 必填。注意：mosquitto.conf 中 go-auth 回调地址固定为 `host.docker.internal:3000`，server 需监听 3000 端口。

### 3. 执行迁移

```bash
pnpm db:migrate
```

### 4. 启动服务

```bash
pnpm dev
```

Server 提供：

- `POST /api/v1/participants` — 注册参与者，返回 MQTT token
- `POST /api/v1/rooms`
- `GET /api/v1/rooms`
- `GET /api/v1/rooms/:id/history`
- `POST /api/v1/auth/mqtt/{user,superuser,acl}` — broker 回调（go-auth HTTP 后端）

### 收发消息示例（SDK）

```ts
import { OpcClient } from '@opc/sdk';

const http = new OpcHttpClient('http://localhost:3000');
const { token } = await http.registerParticipant('alice');

const client = new OpcClient({
  baseUrl: 'http://localhost:3000',
  brokerUrl: 'mqtt://localhost:1883',
  participantId: 'alice',
  token,
});
client.connect();
client.subscribeRoom(roomId);
client.events.on('message.delivered', (e) => console.log(e.message));
client.sendText(roomId, 'hello');
```

## 数据库脚本（packages/database）

- `pnpm db:generate` - 先构建 schema 再生成迁移 SQL
- `pnpm db:migrate` - 执行未应用的迁移
- `pnpm db:push` - 直接同步 schema 到数据库（开发用）
- `pnpm db:studio` - 启动 Drizzle Studio 可视化查看数据

## 常用脚本

- `pnpm build` - 构建所有包
- `pnpm test` - 运行单元测试
- `pnpm test:e2e` - 运行 E2E 测试（需先启动 PostgreSQL 与 Mosquitto）
- `pnpm lint` - 代码检查
- `pnpm typecheck` - TypeScript 类型检查

## E2E 测试

E2E 测试会启动真实 OPC server，连接 PostgreSQL 与 Mosquitto：

```bash
docker compose up -d --build
pnpm test:e2e
```

CI 中会自动启动 PostgreSQL 16 service container、构建并启动 mosquitto 容器，然后运行 `pnpm test` + `pnpm test:e2e`。

## 分支与发布流程

本仓库采用 develop → release → master 的分支模型，版本号由 changesets 自动计算（PR 提交 `.changeset/*.md`，发版时按最高 bump 级别递增）。`master` 为稳定发布分支，release PR 合入后自动打 tag、创建 GitHub Release、推送 `latest` Docker 镜像并回合并 develop。详见 [.github/DEVELOPMENT_GUIDE.md](.github/DEVELOPMENT_GUIDE.md)。
