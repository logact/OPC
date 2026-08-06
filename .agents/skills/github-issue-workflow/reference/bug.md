# Bug workflow (`bug`)

`ready check` → `reproduce` → `analyze` → `fix` → PR → CI → merge.
No human gates, no e2e step — a bug fix is hands-off once triaged and
labeled `ready`. Work in the issue's worktree from skill step 2. `REPO`/`N`
are the resolved repo and issue.

## 1. ready check — the only gate

The ONLY gate before implementation is the `ready` label, exactly as in the
feat workflow: `ready` present → continue; missing → comment
`🤖 [blocked] issue not labeled "ready" — needs a human to finish planning and add the ready label`,
board `Blocked`, and stop.

## 2. reproduce

1. Read the issue carefully; follow its reproduction steps against the code
   in the worktree.
2. **Reproducible** → note the exact evidence (commands, output) and continue.
3. **Not reproducible** → comment exactly what you tried and what happened,
   ask the reporter for the missing detail (environment, versions, steps),
   mark `🤖 [blocked] not reproducible — needs reporter input`, board
   `Blocked`, and stop.

## 3. analyze

1. Find the root cause in the code.
2. Explain **why the existing tests did not catch it** (missing case, wrong
   assumption, untested path).
3. Post both as ONE issue comment. Do NOT fix anything yet.

## 4. fix

1. Fix the root cause so all existing tests pass.
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
