# Bug workflow (`bug`)

`reproduce` → `analyze` → `e2e` (regression) → `fix` → PR → CI → merge.
No human gates — a bug fix is hands-off once triaged. Work in the issue's
worktree from skill step 2. `REPO`/`N` are the resolved repo and issue.

## 1. reproduce

1. Read the issue carefully; follow its reproduction steps against the code
   in the worktree.
2. **Reproducible** → note the exact evidence (commands, output) and continue.
3. **Not reproducible** → comment exactly what you tried and what happened,
   ask the reporter for the missing detail (environment, versions, steps),
   mark `🤖 [blocked] not reproducible — needs reporter input`, board
   `Blocked`, and stop.

## 2. analyze

1. Find the root cause in the code.
2. Explain **why the existing tests did not catch it** (missing case, wrong
   assumption, untested path).
3. Post both as ONE issue comment. Do NOT fix anything yet.

## 3. e2e — regression test

1. Add (or adjust) an e2e/regression test that exposes this bug — it must
   FAIL without the fix and PASS with it.
2. Commit the test. Do NOT fix the bug yet.

## 4. fix

1. Fix the root cause so the regression test and all existing tests pass.
2. Commit and push.
3. Open the PR:
   ```sh
   gh pr create --repo <REPO> --title "fix #<N> <issue title>" --body "Closes #<N>"
   ```
4. Comment `🤖 [in-review] PR #<PR> open — watching CI`; board → `In Review`.

## 5. CI tail

Identical to the feat workflow: watch `gh pr checks`, fix failures in the
worktree and push (max 3 attempts → `Blocked`), on green
`gh pr merge <PR> --repo <REPO> --squash`, board `Done`, final
`🤖 [done]` comment.
