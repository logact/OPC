# 开发指南

本仓库采用 **Git Flow 简化版 + changesets**（参照 Rocket.Chat 的分支与发版模型）：日常开发在 `develop`，版本号由累积的 changesets 自动计算，发布经 `release-*` 分支合并到 `master`，`master` 对应线上稳定版本。

## 分支模型

```
feature 分支 ──┐
feature 分支 ──┼──→ develop ──→ release-X.Y.Z ──→ master ──→ 生产环境
feature 分支 ──┘   (日常开发)      (RC 测试)        (稳定版)
```

| 分支 | 角色 | 代码状态 |
| --- | --- | --- |
| `develop` | 开发主线（默认分支） | 最新功能、未发布、可能不稳定 |
| `release-X.Y.Z` | 发布准备 | 从 `develop`（next）或 `master`（patch）切出，承载 RC 迭代 |
| `master` | 稳定发布 | 只接收 release 分支合并，受分支保护（需 `CI Done` 通过） |

## 版本号如何决定

**版本号不手填**，由 [changesets](https://github.com/changesets/changesets) 自动计算：

- 每个有用户可见变更的 PR 附带一个 `.changeset/*.md`（运行 `pnpm changeset` 生成），声明 bump 级别（patch / minor / major）与摘要。
- 发版时 CI 消费累积的 changesets，**按最高 bump 级别**递增版本：有 minor 就是 minor 版本，全是 fix 就是 patch 版本。
- 版本载体是 `apps/server/package.json`（根 `package.json` 由 workflow 同步），RC 阶段格式为 `X.Y.Z-rc.N`。
- `changeset version` 同时聚合生成 `apps/server/CHANGELOG.md`。

## 日常开发（PR → develop）

- feature 分支向 `develop` 发起 PR；有用户可见变更时提交 changeset。
- PR 触发 `ci.yml`：build → typecheck/lint → unit + e2e 测试。
- PR 上测试失败**不重试**；`develop` / `master` / `release-*` 分支 push 触发 CI 时自动重试 2 次。

## 发布流程

全部通过 Actions 页面的 **Start New Release**（`new-release.yml`）手动触发，四个动作：

1. **`next`**（基线 `develop`）：进入 RC 模式，按 changesets 算出 `X.Y.Z-rc.0`，切 `release-X.Y.Z` 分支，打 RC tag + GitHub prerelease，自动开 PR → master（`pr-update-description.yml` 会写入 changelog 预览）。
2. **`cut`**（基线 `release-X.Y.Z`）：RC 期间修复合入 release 分支后，递增 RC 序号（`-rc.1`、`-rc.2`…）并打 prerelease tag。
3. **`finalize`**（基线 `release-X.Y.Z`）：退出 RC 模式，版本变为正式 `X.Y.Z`。之后合并 PR 到 master。
4. **`patch`**（基线 `master`）：热修场景，直接 patch+1（如 `1.2.3` → `1.2.4`），无 RC，切 release 分支并开 PR。

**合并 release PR 到 master 后**（`publish-release.yml` 自动执行）：

- 校验版本号非 RC（未 finalize 的合入会失败）；
- 打 `vX.Y.Z` tag 并创建正式 GitHub Release；
- 回合并 master → develop，同步版本号与 CHANGELOG；
- `ci.yml` 的 docker job 推送 ghcr 镜像：`X.Y.Z`、`latest`、`master`、`sha-<commit>`（develop push 推 `develop` + `sha-<commit>`）。

## 本地开发

见根目录 [README.md](../README.md) 的"快速开始"一节。

## 常用脚本

- `pnpm build` — 构建所有包
- `pnpm test` / `pnpm test:e2e` — 单元 / E2E 测试（E2E 需 PostgreSQL）
- `pnpm lint` / `pnpm typecheck` — 代码检查 / 类型检查
- `pnpm changeset` — 为当前改动添加 changeset
