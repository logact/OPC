# 开发指南

本仓库采用 **Git Flow 简化版**（参照 Rocket.Chat 的分支模型）：日常开发在 `develop`，发布经 `release-*` 分支合并到 `master`，`master` 对应线上稳定版本。

## 分支模型

```
feature 分支 ──┐
feature 分支 ──┼──→ develop ──→ release-X.Y.Z ──→ master ──→ 生产环境
feature 分支 ──┘   (日常开发)      (发布准备)        (稳定版)
```

| 分支 | 角色 | 代码状态 |
| --- | --- | --- |
| `develop` | 开发主线 | 最新功能、未发布、可能不稳定 |
| `release-X.Y.Z` | 发布准备 | 从 `develop`（常规版本）或 `master`（patch）切出，用于 RC 测试 |
| `master` | 稳定发布 | 只接收 release 分支合并，对应生产环境 |

## CI/CD 流程

### 日常开发（PR → develop）

- 所有 feature 分支向 `develop` 发起 PR。
- PR 触发 `ci.yml`：build → typecheck/lint → unit + e2e 测试。
- PR 上测试失败**不重试**；`develop` / `master` / `release-*` 分支上的 push 触发 CI 时，测试失败自动重试 2 次（vitest `--retry`）。

### 发布准备（release 分支）

1. 在 Actions 页面手动运行 **Start New Release**（`new-release.yml`）：
   - 输入版本号 `X.Y.Z` 与基线分支（`develop` 或 `master`）。
   - 自动创建 `release-X.Y.Z` 分支并 bump `package.json` 版本。
2. 从 `release-X.Y.Z` 向 `master` 发起 PR：
   - `pr-update-description.yml` 自动将 changelog 预览写入 PR 描述。
   - 在该 PR 上完成 review 与 RC 验证。

### 正式发布（合并到 master）

`release-*` PR 合并进 `master` 后自动触发：

- **`publish-release.yml`**：按 `package.json` 版本打 `vX.Y.Z` tag 并创建正式 GitHub Release（tag 已存在则跳过）。
- **`ci.yml` 的 docker job**：构建并推送 ghcr 镜像，tag 为 `master`、`sha-<commit>`、`X.Y.Z`、`latest`。
- `develop` 分支的 push 也会推送镜像，tag 为 `develop` 与 `sha-<commit>`。

## 本地开发

见根目录 [README.md](../README.md) 的"快速开始"一节。

## 常用脚本

- `pnpm build` — 构建所有包
- `pnpm test` / `pnpm test:e2e` — 单元 / E2E 测试（E2E 需 PostgreSQL）
- `pnpm lint` / `pnpm typecheck` — 代码检查 / 类型检查
