# Changesets

本目录由 [@changesets/cli](https://github.com/changesets/changesets) 管理，用于驱动版本号与 CHANGELOG。

- 每个有用户可见变更的 PR，添加一个 changeset：

  ```bash
  pnpm changeset
  ```

  按提示选择 bump 级别（patch / minor / major）并写一句摘要，提交生成的 `.changeset/*.md`。

- 发版时（Actions → Start New Release → `next`），CI 消费累积的 changesets，
  按最高 bump 级别自动算出下一个版本号（RC 阶段为 `X.Y.Z-rc.N`）。

内部包（`@opc/*`）不参与版本管理，只有根包 `opc-server` 承载版本号。
