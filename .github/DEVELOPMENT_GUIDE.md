# 开发指南

本仓库是 **OPC 移动端客户端**，采用 **React Native + pnpm monorepo + Git Flow 简化版 + changesets** 的管理方式：日常开发在 `develop`，版本号由累积的 changesets 自动计算，发布经 `release-*` 分支合并到 `master`，`master` 对应线上稳定版本。

## 分支模型

```
feature 分支 ──┐
feature 分支 ──┼──→ develop ──→ release-X.Y.Z ──→ master ──→ 应用商店
feature 分支 ──┘   (日常开发)      (RC 测试)        (稳定版)
```

| 分支 | 角色 | 代码状态 |
| --- | --- | --- |
| `develop` | 开发主线（默认分支） | 最新功能、未发布、可能不稳定；受保护（必须 PR + `CI Done` 通过） |
| `release-X.Y.Z` | 发布准备 | 从 `develop`（next）或 `master`（patch）切出，承载 RC 迭代 |
| `master` | 稳定发布 | 只接收 release 分支合并，受分支保护（需 `CI Done` 通过） |

## 版本号如何决定

**版本号不手填**，由 [changesets](https://github.com/changesets/changesets) 自动计算：

- 每个有用户可见变更的 PR 附带一个 `.changeset/*.md`（运行 `pnpm changeset` 生成），声明 bump 级别（patch / minor / major）与摘要。
- 发版时 CI 消费累积的 changesets，**按最高 bump 级别**递增版本：有 minor 就是 minor 版本，全是 fix 就是 patch 版本。
- 版本载体是 `apps/mobile/package.json`（根 `package.json` 由 workflow 同步），RC 阶段格式为 `X.Y.Z-rc.N`。
- `changeset version` 同时聚合生成 `apps/mobile/CHANGELOG.md`。

## 项目结构

```
.
├── apps/
│   └── mobile/          # React Native 客户端
│       ├── android/     # Android 原生工程
│       ├── ios/         # iOS 原生工程
│       └── src/         # TypeScript / React 源码
├── packages/            # 共享包（如 API client、组件库、工具函数）
├── package.json
├── pnpm-workspace.yaml
└── .github/workflows/   # CI/CD
```

## 日常开发（PR → develop）

- feature 分支向 `develop` 发起 PR；有用户可见变更时提交 changeset（`pnpm changeset` 交互式生成）。
- changeset 是**强制的**：`changeset-check.yml` 会拦截没有新增 `.changeset/*.md` 的 PR；纯文档/CI/测试类改动可加 `no-changeset` label 豁免。changesets-bot 也会在 PR 上评论提醒。
- PR 触发 `ci.yml`：安装依赖 → 构建共享包 → bundle JS → typecheck/lint → 单元测试。
- PR 上测试失败**不重试**；`develop` / `master` / `release-*` 分支 push 触发 CI 时自动重试 2 次。
- 合入 `develop` / `master` / `release-*` 后，`build-mobile.yml` 会在 CI 中构建 Android APK/AAB 与 iOS archive，产物保存 14 天。

## 发布流程

全部通过 Actions 页面的 **Start New Release**（`new-release.yml`）手动触发，四个动作：

1. **`next`**（基线 `develop`）：进入 RC 模式，按 changesets 算出 `X.Y.Z-rc.0`，切 `release-X.Y.Z` 分支，打 RC tag + GitHub prerelease，自动开 PR → master（`pr-update-description.yml` 会写入 changelog 预览）。
2. **`cut`**（基线 `release-X.Y.Z`）：RC 期间修复合入 release 分支后，递增 RC 序号（`-rc.1`、`-rc.2`…）并打 prerelease tag。
3. **`finalize`**（基线 `release-X.Y.Z`）：退出 RC 模式，版本变为正式 `X.Y.Z`。之后合并 PR 到 master。
4. **`patch`**（基线 `master` 或旧版本 tag `vX.Y.Z`）：热修场景，直接 patch+1，无 RC。
   - 基线 `master`（修当前线上版本）：切 release 分支并开 PR → master，合并后走正式发布流程。
   - 基线旧 tag（修历史版本）：从该 tag 切 release 分支，**直接打 tag + GitHub Release（不标记 latest），不合回 master**；CI 会构建该版本产物。修复需自行 cherry-pick 回 develop 及活跃中的 release 分支。

**合并 release PR 到 master 后**（`publish-release.yml` 自动执行）：

- 校验版本号非 RC（未 finalize 的合入会失败）；
- 打 `vX.Y.Z` tag 并创建正式 GitHub Release；
- 回合并 master → develop（因 develop 受保护，改为自动开 PR 并启用自动合并，CI 通过后自动合入）；
- `ci.yml` 的 native-build job 会在 develop / master / release-* push 时构建 Android 与 iOS 产物。

## 本地开发

```bash
# 安装依赖
pnpm install

# 启动 Metro
pnpm --filter @opc/mobile start

# Android
pnpm --filter @opc/mobile android

# iOS（macOS  only）
pnpm --filter @opc/mobile ios
```

## 常用脚本

- `pnpm build` — 构建共享包
- `pnpm test` — 运行单元测试（Jest）
- `pnpm lint` / `pnpm typecheck` — 代码检查 / 类型检查
- `pnpm changeset` — 为当前改动添加 changeset

## CI/CD 说明

- `.github/actions/setup-pnpm`：统一安装 pnpm + Node + 依赖。
- `ci.yml`：PR / push 时触发，负责构建、检查、测试与原生构建。
- `ci-checks.yml` / `ci-test.yml`：被 `ci.yml` 复用的检查与测试子流程。
- `build-mobile.yml`：Android（Ubuntu + JDK 17 + Gradle）与 iOS（macOS + Xcode + CocoaPods）原生构建。
- `changeset-check.yml`：确保 develop PR 携带 changeset。
- `new-release.yml` / `publish-release.yml`：changeset 驱动的发版流程。

> 如需使用 Expo EAS 构建，可在 `build-mobile.yml` 中替换 native 构建步骤为 `eas build --platform android --platform ios`。
