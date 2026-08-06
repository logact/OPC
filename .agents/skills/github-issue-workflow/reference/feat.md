# Feat workflow (`feat`, `enhancement`)

`ready check` → `implement` → PR → CI → merge. No human gates, no e2e
step: issues are fully planned before they reach the agent and carry the
`ready` label, so the agent implements them directly. Work in the issue's
worktree from skill step 2. `REPO`/`N` are the resolved repo and issue.

## 1. ready check — the only gate

The ONLY gate before implementation is the `ready` label.

1. List the issue's labels: `gh issue view <N> --repo <REPO> --json labels`.
2. `ready` present → proceed to step 2 (implement).
3. `ready` missing → do NOT implement. Comment
   `🤖 [blocked] issue not labeled "ready" — needs a human to finish planning and add the ready label`,
   board `Blocked`, and stop. A human restarts the workflow by adding the
   `ready` label.

## 2. implement

1. Read the issue and its comments; explore the relevant code in the worktree.
2. Implement exactly what the issue specifies. Run the module's existing
   tests; iterate until all green.
3. Commit with a clear message and push the branch.
4. Open the PR:
   ```sh
   gh pr create --repo <REPO> --title "#<N> <issue title>" --body "Closes #<N>"
   ```
5. Comment `🤖 [in-review] PR #<PR> open — watching CI`; board → `In Review`.

## 3. CI tail

1. Watch: `gh pr checks <PR> --repo <REPO>`. While pending, re-check every
   60s.
2. Failing → diagnose (`gh run view --log-failed --repo <REPO>`), fix in the
   worktree, push. At most **3 attempts**; then comment
   `🤖 [blocked] CI still failing after 3 attempts on PR #<PR>` + board
   `Blocked`, and stop.
3. Green → `gh pr merge <PR> --repo <REPO> --squash`, board → `Done`,
   comment `🤖 [done] PR #<PR> merged — <what shipped>`. The PR body closes
   the issue automatically.
