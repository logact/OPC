---
name: github-issue-workflow
description: >-
  Handle a GitHub issue end to end according to its labels: feat and
  enhancement run the feat workflow (align → e2e → plan → implement → PR →
  CI → merge, with human approval gates), bug runs the bug workflow
  (reproduce → analyze → regression test → fix → PR → merge), idea is clarified
  by the agent in an issue comment (understanding, open questions, proposal)
  until a human re-labels it, and question is answered by posting the
  answer as a comment under the issue (no code changes). Use when the user
  asks to "handle",
  "implement", "dev", "fix", or "work on" a GitHub issue (link or number),
  when an issue has type (feat/bug/enhancement/idea) or module labels, or
  when running as an Orca-dispatched worker whose task references an issue.
---

# GitHub Issue Workflow

Handle ONE GitHub issue per session, routed by its labels. All paths in this
skill are relative to this skill's directory.

## Inputs

The user gives an issue link (`https://github.com/<owner>/<repo>/issues/<N>`)
or a number plus repo. Resolve: `REPO=<owner>/<repo>`, `N=<issue number>`.

## Step 0 — Mode detection

- If your session prompt contains an Orca orchestration dispatch preamble
  (a `taskId`/`dispatchId` pair and a coordinator handle) → you are a
  **dispatched worker**: read `reference/worker.md` and do exactly the step
  the dispatch names. Nothing else in this file applies.
- Otherwise → **standalone mode**: continue here and drive the full workflow
  yourself, with the human answering gates in issue comments or in chat.

## Step 1 — Triage

```sh
gh issue view <N> --repo <REPO> --json title,body,labels,comments
```

Route by labels (read `reference/conventions.md` for the full scheme):

| Labels | Action |
| --- | --- |
| `feat` or `enhancement` | Run the **feat workflow** — read `reference/feat.md` and follow it exactly |
| `bug` | Run the **bug workflow** — read `reference/bug.md` and follow it exactly |
| `idea` | Do NOT implement. Clarify the idea: restate your understanding of it, identify ambiguities and open questions, and propose how it could become a concrete feat — posted as ONE issue comment. Keep refining through follow-up comments until a human re-labels the issue, then stop |
| `question` | Do NOT implement. Read the issue, investigate the code/docs as needed, and post the answer as ONE issue comment (if the question is unclear, comment asking for clarification instead). Then stop |
| none of the above | Do NOT guess. Ask the user which workflow applies, or comment on the issue asking for a `feat`/`bug`/`enhancement`/`idea`/`question` label, then stop |

(A legacy `type:` prefix — e.g. `type:feat` — is equivalent and also accepted.)

Module: take the `module:<name>` label if present. If missing, infer the
module from the issue content and the repo layout, and state your inferred
module in the triage comment so a human can correct it. If you cannot decide
confidently, ask in chat (standalone) or comment on the issue asking for a
`module:<name>` label, and stop. Whatever the module, keep your changes
inside that module's code area.

## Step 2 — Setup an isolated worktree

Never work in the user's current checkout.

- Under Orca (preferred, `orca status --json` shows a ready runtime):
  ```sh
  orca worktree create --name issue-<N> --issue <N> --no-parent --json
  ```
  Work in the returned path; Orca manages the branch.
- Otherwise:
  ```sh
  cd <repo checkout> && git fetch origin && git worktree add ../<repo-name>-issue-<N> -b issue/<N> origin/<default-branch>
  ```

## Step 3 — Board mirroring (best-effort)

If the issue lives on a Projects V2 board, mirror your progress with
`scripts/board-status.sh <owner> <projectNumber> <REPO> <N> "<Status>"` at each
transition (`In Progress` → `In Review` → `Done` / `Blocked`). The board is a
mirror, not the mechanism: on a scopes error the script prints a hint and
exits 0 — continue without it.

## Step 4 — Run the routed workflow

Follow the reference file exactly. Shared rules:

- **Comment on the issue at every lifecycle point** — mandatory, not optional:
  - **Start** — as soon as you take the issue: `🤖 [triaged] type=<type> module=<module> — starting <workflow> workflow`
  - **Problem** — the moment something goes wrong or you need a human: `🤖 [blocked] <reason>` or `🤖 [failed] <what failed, what you tried, what's left>`
  - **Success** — when finished: `🤖 [done] <what shipped, fixed, or answered>`
  - **Failure** — when giving up: `🤖 [failed] <reason>` (and board `Blocked`)
  - Plus one compact `🤖 [<status>] <one line>` comment at each step transition
    in between. Command: `gh issue comment <N> --repo <REPO> --body "🤖 [<status>] <one line>"`
- **Human gates** (feat only): after posting a gate comment, wait with
  `scripts/gate-watch.sh <REPO> <N> "gate:<step>" <approver1,approver2> --wait 1800`.
  Approvers = the issue author and the user who gave you the task. In
  standalone mode the chat user may also approve or give feedback directly in
  chat — treat that exactly like the corresponding issue comment.
- **CI tail** (both workflows): watch `gh pr checks <PR> --repo <REPO>`; on
  failure diagnose with `gh run view --log-failed`, fix, push — at most 3
  attempts, then comment `🤖 [blocked] CI still failing after 3 attempts …`
  and stop. On green: `gh pr merge <PR> --repo <REPO> --squash`.
- Keep changes scoped to the module; never commit secrets; never force-push.

## Done means

PR merged (squash), issue closed by the PR's `Closes #<N>` body, board at
`Done`, and a final `🤖 [done]` issue comment summarizing what shipped.
Anything unrecoverable → `🤖 [blocked] <reason>` comment, board `Blocked`,
and stop — do not retry loops beyond the limits in the reference files.
