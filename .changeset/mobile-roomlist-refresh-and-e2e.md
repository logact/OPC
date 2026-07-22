---
'@opc/mobile': patch
---

fix(mobile): 会话列表返回后不刷新、新会话沉底不可见

- `RoomListScreen` 改为 `useFocusEffect` 时重取房间列表：之前只在 mount 时加载，从房间/建群页返回后列表是旧数据，新建群和新消息预览都不回显（与 ContactsScreen/MeScreen 同一模式）
- 列表改为按 `createdAt` 最新在前：server 按 created_at ASC 返回，新会话排在屏外，用户看不到刚建的群

同时修复 mobile e2e 基础设施：

- `Info.plist` ATS 移除 `NSAllowsLocalNetworking`（iOS 10+ 存在其他全局例外 key 时 `NSAllowsArbitraryLoads` 会被忽略，导致公网明文测试服务器被 ATS 拦截）
- Maestro seed 子流程移除内联 `env:` 块（flow 内联 env 会遮蔽命令行 `-e OPC_SERVER_URL`，seed 永远打到 localhost:3000）
- e2e 套件改为 fail-fast 执行（任一 flow 失败即整体失败，不再重跑），删除断言方式不可靠的 00-net-probe
