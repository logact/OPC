# Worker mode (Orca-dispatched)

You are here because your session prompt contained an Orca orchestration
dispatch preamble: a `taskId`, a `dispatchId`, and a coordinator handle. An
orchestrator (usually the `github-kimi-workflow` daemon) owns the workflow
state machine; you execute exactly ONE step of it.

## Rules

1. Do exactly the step named in the dispatch (`align`, `e2e`, `plan`,
   `implement`, `fix_ci`, `reproduce`, `analyze`, `fix`) — nothing more.
   The step's deliverables are in the dispatch spec; the workflow definitions
   in `reference/feat.md` / `reference/bug.md` explain how the step fits.
2. Your working directory is the Orca-managed worktree you were launched in.
   Keep changes inside the issue's module.
3. Fetch the issue and comments anytime:
   `gh issue view <N> --repo <REPO> --comments`
4. If blocked and the coordinator must decide, use:
   `orca orchestration ask --to <coordinator-handle> --question "<question>" --json`
5. When — and only when — the step's deliverables are complete, report
   EXACTLY ONCE, as the very last thing you do:

   ```sh
   orca orchestration send --to <coordinator-handle> --type worker_done \
     --subject "issue-<N> <step> done" --body "<short summary>" \
     --payload '{"taskId":"<id>","dispatchId":"<id>","summary":"<what you did>"}' \
     --json
   ```

   Your `taskId`/`dispatchId` are in the dispatch message; recover them with
   `orca orchestration inbox --json` if lost. Only use `"unknown"` if they are
   truly unrecoverable.

6. Step-specific payload fields (add to the payload JSON):
   - `align`, `e2e` (feat): `"gate":"<step>"` — after posting the gate comment
   - `plan`: `"jobs":[{id,name,e2e,ref,req,description}, ...]`
   - `implement`, `fix`: `"prNumber":<number>`
   - `reproduce`: `"reproduced":true|false` (+ evidence in `summary`)
   - `fix_ci`: none — the PR already exists

7. After sending `worker_done`, end your turn and idle. Do not poll
   `orca orchestration check`; the coordinator re-engages you with a fresh
   dispatch for the next step, in this same terminal — so your session
   context carries over.

Never report `worker_done` before the deliverables are actually done, and
never report twice. If the step is impossible, report `worker_done` with a
`summary` explaining the failure rather than staying silent — the
orchestrator counts on exactly one report per dispatch.
