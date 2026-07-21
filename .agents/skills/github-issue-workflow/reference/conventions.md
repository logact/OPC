# Conventions

Shared conventions for the issue workflow. Both the standalone agent and
Orca-dispatched workers follow these; the optional Bun daemon
(`github-kimi-workflow/src`) uses the same ones, so humans see one consistent
protocol no matter who drives an issue.

## Labels

- **Type** (exactly one): `feat`, `bug`, `enhancement`, `idea`, `question`
  (a legacy `type:` prefix — `type:feat` etc. — is equivalent).
  `enhancement` runs the feat workflow. `idea` is clarified in an issue
  comment (understanding, open questions, a concrete proposal) — no
  implementation until a human re-labels it. `question` is answered
  directly in an issue comment — no code changes.
- **Module** (zero or one): `module:<name>` — shards work by code area; agents
  keep their changes inside their module. Module labels are created on demand;
  when no module label is present the agent infers the module from the issue
  content and repo layout, and says what it inferred.

## Board Status mapping (Projects V2)

| Workflow state | Board Status |
| --- | --- |
| triaged / queued | `In Queue` |
| agent working (incl. waiting at a gate) | `In Progress` |
| PR open, watching CI | `In Review` |
| PR merged | `Done` |
| unrecoverable failure / needs a human | `Blocked` |

Mirroring is best-effort via `scripts/board-status.sh`; never block the
workflow on board failures (missing `project` token scope is fine).

## Human gate protocol

1. The agent finishes a gated step (feat: `align`, `e2e`) and posts ONE issue
   comment whose first line is a hidden marker: `<!-- gate:<step> -->`,
   followed by the deliverable (spec, or e2e test summary).
2. An approver replies on the issue:
   - `/approve` or `/lgtm` (case-insensitive, start of comment) → proceed
   - any other comment → feedback: the agent revises the step and re-posts
     the FULL updated deliverable with a fresh marker
3. Detection: among comments after the NEWEST marker comment, take the newest
   comment by an approver. `scripts/gate-watch.sh` implements exactly this.
4. Approvers: the issue author + the user who assigned the task. In standalone
   mode, the chat user may approve/give feedback directly in chat — equivalent.
5. No approver response within 30 minutes → comment `🤖 [blocked] gate "<step>"
   timed out` and stop. A human restarts by replying on the issue.

## Tracing

The issue's comment thread is the audit trail. Four lifecycle comments are
**mandatory** on every handled issue — **start** (`[triaged]`), **problem**
(`[blocked]` / `[failed]`), **success** (`[done]`), and **failure**
(`[failed]`) — plus one compact comment per step transition in between:

```
🤖 [triaged] type=feat module=server — starting feat workflow
🤖 [in-progress] step "align" started
🤖 [gated] waiting for human approval of "e2e"
🤖 [in-review] PR #57 open — watching CI
🤖 [done] PR #57 merged — <what shipped>
🤖 [blocked] <reason — needs a human>
🤖 [failed] <what failed, what was tried, what's left>
```

For `question`/`idea` issues the answer/clarification comment doubles as the
`[done]` comment — prefix it with `🤖 [done]` and it counts.

## worker_done contract (Orca workers only)

See `reference/worker.md`. Payload fields by step: `gate:"align"|"e2e"`,
`jobs:[...]`, `prNumber:<n>`, `reproduced:true|false` — plus always
`taskId`, `dispatchId`, `summary`.
