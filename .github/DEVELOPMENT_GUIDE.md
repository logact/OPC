# 开发指南

本仓库采用 **GitHub Flow**：只有一个主分支 `main`，所有改动通过 PR 合并到 `main`，发布直接从 `main` 通过 changesets 计算版本并打 tag。

## 分支模型

```
feature/xxx ──┐
hotfix/xxx  ──┼──▶ main ──▶ tag vX.Y.Z ──▶ Release / Docker latest
feature/yyy ──┘  (主干分支)
```

| 分支 | 角色 | 代码状态 |
| --- | --- | --- |
| `main` | 唯一长期分支 | 最新功能；通过 CI 保护，必须 PR 合并 |
| `feature/*` | 功能开发 | 短命分支，合并后立即删除 |
| `hotfix/*` | 紧急修复 | 短命分支，合并后立即删除 |

## 版本号如何决定

**版本号不手填**，由 [changesets](https://github.com/changesets/changesets) 自动计算：

- 每个有用户可见变更的 PR 附带一个 `.changeset/*.md`（运行 `pnpm changeset` 生成），声明 bump 级别（patch / minor / major）与摘要。
- 发布时运行 `Release` workflow，在 `main` 上执行 `pnpm changeset version`，按最高 bump 级别递增版本。
- 版本载体是 `apps/server/package.json`（根 `package.json` 由 workflow 同步）。
- `changeset version` 同时聚合生成 `apps/server/CHANGELOG.md`。

## 日常开发

1. 从 `main` 切出 feature 分支：
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/xxx
   ```

2. 开发并提交。如果改动对用户可见，添加 changeset：
   ```bash
   pnpm changeset
   ```

3. 发起 PR 到 `main`。
4. PR 触发 `ci.yml`：build → typecheck/lint → unit + e2e 测试。
5. `changeset-check.yml` 会拦截没有新增 `.changeset/*.md` 的 PR；纯文档/CI/测试类改动可加 `no-changeset` label 豁免。
6. CI 通过后合并到 `main`，删除 feature 分支。

## 发布流程

1. 进入 Actions → **Release** workflow → Run workflow。
2. workflow 在 `main` 上执行 `pnpm changeset version`，计算新版本。
3. 自动提交 `chore: release X.Y.Z` 并推送回 `main`。
4. 自动打 tag `vX.Y.Z` 并推送。
5. 自动创建 GitHub Release。
6. tag push 触发 `ci.yml`，构建并推送 Docker 镜像：
   - `ghcr.io/{owner}/opc-server:X.Y.Z`
   - `ghcr.io/{owner}/opc-server:latest`

## 热修复流程

1. 从 `main` 切出 hotfix 分支：
   ```bash
   git checkout main
   git pull origin main
   git checkout -b hotfix/xxx
   ```

2. 修复 bug，添加 patch changeset。
3. PR → `main`。
4. 合并后触发 **Release** workflow，发布 patch 版本。

## 分支保护

- `main` 受保护：必须通过 PR 合并，且 `CI Done` 检查通过。
- 不允许 force push 或直接删除。

## 常用脚本

- `pnpm build` — 构建所有包
- `pnpm test` / `pnpm test:e2e` — 单元 / E2E 测试（E2E 需 PostgreSQL）
- `pnpm lint` / `pnpm typecheck` — 代码检查 / 类型检查
- `pnpm changeset` — 为当前改动添加 changeset
