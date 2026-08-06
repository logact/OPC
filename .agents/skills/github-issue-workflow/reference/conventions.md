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
- **`ready`** — the ONLY gate before implementation. Issues are fully planned
  by humans before dispatch; an implementation workflow (`feat`,
  `enhancement`, `bug`) starts only when the issue carries the `ready`
  label. Without it the agent comments `🤖 [blocked]` and stops.

## Board Status mapping (Projects V2)

| Workflow state | Board Status |
| --- | --- |
| triaged / queued | `In Queue` |
| agent working | `In Progress` |
| PR open, watching CI | `In Review` |
| PR merged | `Done` |
| unrecoverable failure / needs a human | `Blocked` |

Mirroring is best-effort via `scripts/board-status.sh`; never block the
workflow on board failures (missing `project` token scope is fine).

## Tracing

The issue's comment thread is the audit trail. Four lifecycle comments are
**mandatory** on every handled issue — **start** (`[triaged]`), **problem**
(`[blocked]` / `[failed]`), **success** (`[done]`), and **failure**
(`[failed]`) — plus one compact comment per step transition in between:

```
🤖 [triaged] type=feat module=server — starting feat workflow
🤖 [in-progress] step "implement" started
🤖 [in-review] PR #57 open — watching CI
🤖 [done] PR #57 merged — <what shipped>
🤖 [blocked] <reason — needs a human>
🤖 [failed] <what failed, what was tried, what's left>
```

For `question`/`idea` issues the answer/clarification comment doubles as the
`[done]` comment — prefix it with `🤖 [done]` and it counts.

## worker_done contract (Orca workers only)

See `reference/worker.md`. Payload fields by step: `jobs:[...]`,
`prNumber:<n>`, `reproduced:true|false` — plus always `taskId`, `dispatchId`,
`summary`.
