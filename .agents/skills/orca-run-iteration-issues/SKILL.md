---
name: orca-run-iteration-issues
description: Scan and drain dependency-ready Todo issues from the current GitHub Project iteration by supervising one Orca Codex worker at a time through merge and Done. Use when asked to schedule, execute, run, or drain the active/current iteration's Todo queue with dependency-aware issue selection, Orca worktrees, and worker_done supervision; supports optional OWNER/REPO and project-number overrides.
---

# Run Iteration Issues with Orca

Repeatedly select exactly one ready issue from the active iteration, supervise it to a verified terminal state, then re-scan. Never dispatch two issue workers concurrently.

## Load Runtime Guidance

Before issuing any Orca command:

1. Invoke and follow `$orca-cli` and `$orchestration`.
2. Resolve the Orca executable exactly as `$orca-cli` directs and reuse it throughout the run.
3. Read the version-matched guides with `ORCA skills get orca-cli` and `ORCA skills get orchestration`, replacing `ORCA` with the resolved executable.
4. Treat those guides as authoritative if any command below differs from the installed runtime.

Do not replace Orca orchestration with generic subagents or ad hoc terminal processes. This is supervised coordination, so create a task and use `dispatch --inject`.

## Resolve Inputs and Scan

Default the repository to the current checkout. Accept `--repo OWNER/REPO` and `--project-number N` overrides from the user. Use today's local date; an iteration is active when `startDate <= today < startDate + duration`.

Run the read-only scanner from this skill directory:

```bash
python3 scripts/scan_iteration_issues.py [--repo OWNER/REPO] [--project-number N] --pretty
```

The scanner discovers projects linked to the repository, identifies iteration fields by GraphQL type rather than spelling, and rejects ambiguous active projects unless `--project-number` disambiguates them. It selects only items assigned to the active iteration whose Status is exactly `Todo` and whose content belongs to the target repository.

The scanner combines native GitHub `blockedBy` links with explicit body declarations beginning with `Depends on` or `Blocked by`. Bare `#123`, `owner/repo#123`, issue URLs, and dependency-list sections are supported. Ordinary references such as `relates to` and `composes with` do not create edges. Only a CLOSED dependency is satisfied; OPEN, missing, and inaccessible dependencies block execution.

Persist or retain the scanner JSON for the current selection. It contains the project/item/field/option IDs required for exact mutations. If the scanner fails, make no project or Orca mutations. If `selectedIssue` is null, report the remaining blocking reasons and stop the run successfully: no executable Todo issue remains.

For a command-only safety check, run `scripts/render_orchestration_plan.py --scan <scan.json> --pretty`. It emits an argv-based dry-run plan and never executes commands.

## Execute One Selected Issue

Perform these steps in order from one fresh scan:

1. Confirm Orca runtime readiness with the runtime guide's status command. Resolve the repository in Orca and confirm its default base matches the GitHub repository's default branch from the scan.
2. Move only `selectedIssue.projectItemId` to `In Progress` with `gh project item-edit`, using the scan's project id, status field id, and `In Progress` option id.
3. Create an independent top-level Orca worktree linked with `--issue <number>`. Use `--no-parent`. Base it on the repository default branch, never the coordinator's current feature branch; either rely on a confirmed Orca default base or pass the exact resolved default-branch ref.
4. Because a custom model is required, launch Codex in that worktree with `codex --model gpt-5.6-terra`. Add no sandbox, full-access, approval, or reasoning flags, so the user's configured sandbox and approval defaults remain intact. Use only the agent terminal handle returned by terminal creation; do not message an incidental fallback shell.
5. Read [worker-contract.md](references/worker-contract.md), substitute the selected issue and project identifiers, and create an Orca orchestration task with that full spec.
6. Wait for the Codex TUI to become idle with an explicit timeout, then dispatch the task to its terminal using `--inject`.
7. Verify the task and dispatch exist with the runtime guide's `task-list` and `dispatch-show` commands before claiming orchestration started.

The usual current-runtime shape is worktree create → terminal create → task-create → terminal wait for `tui-idle` → `dispatch --inject`. Re-read the runtime guides rather than copying that shape blindly.

## Supervise to Completion

Use rolling waits for `worker_done,escalation,decision_gate`. A timeout or empty check is a checkpoint, not a failure. Inspect task state and terminal liveness, then continue waiting while the worker is active.

When the worker uses Orca `ask`, answer its decision-gate message with `orchestration reply`. Ask the user only when the answer requires a material product or authorization choice not already resolved by the issue or repository instructions. Keep waiting after the reply.

Accept lifecycle messages only for the active taskId and dispatchId. The worker must send exactly one dispatch-scoped `worker_done` from its own terminal. Do not manually mark an automatically completed task completed again.

After `worker_done`, independently verify:

```bash
gh issue view <number> --repo <owner/repo> --json state,url
gh api graphql -F itemId=<project-item-id> -f 'query=query($itemId:ID!){node(id:$itemId){... on ProjectV2Item{id fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name optionId}}}}}'
```

Success requires a merged PR, CLOSED issue, and the original project item set to `Done`. If any condition is missing and remediation is possible, create a new recovery task in the retained worktree, dispatch it to the same live worker terminal with a fresh injected preamble, and supervise it. Each dispatch gets exactly one `worker_done`; never accept a premature completion as issue success.

## Handle Unrecoverable Failure

Treat a failure as unrecoverable only after safe in-scope recovery is exhausted or an external decision/permission makes continued progress impossible. Then:

1. Record the concrete reason in the Orca worktree comment and orchestration task result/status where the runtime guide permits it.
2. Move the original project item to `Failed` with the exact IDs from the saved scan.
3. Retain the worktree, branch, terminal history, and artifacts for inspection. Do not remove or reset them.
4. Report the failure and continue the outer scan loop so unrelated ready issues can run.

Never move an issue to `Done` merely because its worker sent `worker_done`. Never move a recoverable issue to `Failed` just because a wait timed out.

## Repeat

After verified success or recorded failure, discard the prior selection result and run the scanner again. Dependencies may have closed, project fields may have changed, and a higher-priority issue may now be ready. Select only the new `selectedIssue` and repeat until a fresh scan returns no executable Todo issue.

Retain successful and failed worktrees unless the user separately requests cleanup. Do not perform a live forward-test of this skill automatically: its normal path mutates project state and merges real work.
