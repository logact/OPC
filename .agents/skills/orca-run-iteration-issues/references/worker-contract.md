# Worker Contract

Use this contract as the Orca orchestration task spec after replacing every placeholder from the fresh scanner result.

```text
Own <issue-url> through verified completion.

Implement the issue in this independent worktree and follow every applicable AGENTS.md instruction. Inspect the issue and labels, implement the complete scope, run proportionate tests, commit and push, then create or update a PR whose body closes <owner/repo>#<number>. Resolve review and CI failures and squash-merge the PR.

Do not report success until all three conditions hold:
1. The PR is merged.
2. The issue is CLOSED.
3. Project #<project-number> item <project-item-id> has Status Done.

After merge and closure, set Done with the exact `gh project item-edit` command assembled from the scanner's project id, status field id, project item id, and Done option id.

Use Orca `ask` for blocking questions. On an unrecoverable failure, report the exact evidence and leave the worktree intact. Send exactly one dispatch-scoped `worker_done` from this terminal for the active taskId/dispatchId, only after success or unrecoverable failure, then end your turn.
```

Do not add Codex sandbox or approval flags. `codex --model gpt-5.6-terra --yolo` must inherit the user's configured defaults.

A successful `worker_done` body must identify the merged PR and confirm both issue closure and Done status. A failure body must name the failed command or external condition, attempts made, and remaining work. In both cases, use the taskId and dispatchId from the live injected preamble and send exactly one `worker_done` for that dispatch.
