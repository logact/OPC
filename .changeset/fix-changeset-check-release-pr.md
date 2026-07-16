---
'@opc/server': patch
---

- Skip changeset check for release PRs (branches matching `release/v*`) to prevent false failures when consuming changesets.
- Use `RELEASE_PAT` instead of `GITHUB_TOKEN` in `tag-release.yml` so that pushing the version tag triggers downstream CI and development deployment workflows.
