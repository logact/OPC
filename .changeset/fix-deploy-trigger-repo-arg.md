---
'@opc/server': patch
---

Fix `deploy-development-on-release.yml` by adding `--repo` to `gh workflow run` so it can trigger deployment without checking out the repository.
