# Feat workflow (`feat`, `enhancement`)

`align` (gate) → `e2e` (gate) → `plan` → `implement` → PR → CI → merge.
Gates loop on feedback; everything else proceeds linearly. Work in the
issue's worktree from skill step 2. `REPO`/`N` are the resolved repo and issue.

## 1. align — spec, human-gated

1. Read the issue and its comments; explore the relevant code in the worktree.
2. Write an alignment spec: your understanding of the problem, the proposed
   scope, and the acceptance criteria — the promise you will implement against.
3. Post it as ONE issue comment, first line exactly `<!-- gate:align -->`:
   ```sh
   gh issue comment <N> --repo <REPO> --body "<!-- gate:align -->
   🔒 **Human gate: align**
   <spec>"
   ```
4. Wait for the gate: `scripts/gate-watch.sh <REPO> <N> "gate:align" <approvers> --wait 1800`
   - `approved` → continue to step 2 (e2e)
   - `feedback: ...` → revise the spec against the feedback, repost the FULL
     revised spec with a fresh marker, wait again
   - timeout / `pending` forever → `🤖 [blocked]` comment, stop

Do NOT write any implementation code in this step.

## 2. e2e — tests first, human-gated

1. Write end-to-end tests that encode the approved acceptance criteria. They
   may fail — the feature does not exist yet.
2. Commit them to the worktree branch.
3. Post ONE comment, first line `<!-- gate:e2e -->`, summarizing the test
   cases (what each proves, how to run them).
4. Gate-wait on `"gate:e2e"` exactly as in step 1; feedback → revise tests,
   commit again, repost, wait again.

Do NOT implement the feature in this step.

## 3. plan — job decomposition (no gate)

Decompose the approved work into jobs. Each job MUST have:
`id`, `name`, `e2e` (related e2e test), `ref` (code area/files it touches),
`req` (requirement it covers), `description`.

Post the job list as ONE issue comment (plain markdown table or list). No
gate — proceed immediately.

## 4. implement

1. Implement every job. Run the e2e tests and the module's existing tests;
   iterate until all green.
2. Commit with a clear message and push the branch.
3. Open the PR:
   ```sh
   gh pr create --repo <REPO> --title "#<N> <issue title>" --body "Closes #<N>"
   ```
4. Comment `🤖 [in-review] PR #<PR> open — watching CI`; board → `In Review`.

## 5. CI tail

1. Watch: `gh pr checks <PR> --repo <REPO>`. While pending, re-check every
   60s.
2. Failing → diagnose (`gh run view --log-failed --repo <REPO>`), fix in the
   worktree, push. At most **3 attempts**; then comment
   `🤖 [blocked] CI still failing after 3 attempts on PR #<PR>` + board
   `Blocked`, and stop.
3. Green → `gh pr merge <PR> --repo <REPO> --squash`, board → `Done`,
   comment `🤖 [done] PR #<PR> merged — <what shipped>`. The PR body closes
   the issue automatically.
