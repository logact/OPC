#!/usr/bin/env python3
"""Render, but never execute, the command plan for one selected issue."""

from __future__ import annotations

import argparse
import json
import re
import shlex
import sys
from pathlib import Path
from typing import Any


def status_command(scan: dict[str, Any], option_name: str) -> list[str]:
    project = scan["project"]
    selected = scan["selectedIssue"]
    return [
        "gh",
        "project",
        "item-edit",
        "--id",
        selected["projectItemId"],
        "--project-id",
        project["id"],
        "--field-id",
        project["statusField"]["id"],
        "--single-select-option-id",
        project["statusField"]["options"][option_name],
    ]


def shell_join(argv: list[str]) -> str:
    return shlex.join(argv)


def issue_slug(number: int, title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.casefold()).strip("-")[:42].rstrip("-")
    return f"issue-{number}-{slug}" if slug else f"issue-{number}"


def worker_spec(scan: dict[str, Any]) -> str:
    issue = scan["selectedIssue"]
    repository = scan["repository"]["nameWithOwner"]
    project = scan["project"]
    done = shell_join(status_command(scan, "Done"))
    return f"""Own {issue['url']} through verified completion.

Implement the issue in this independent worktree and follow all repository AGENTS.md instructions. Inspect the issue and its labels, implement the complete scope, run proportionate tests, commit and push, then create or update a PR whose body closes {repository}#{issue['number']}. Resolve review/CI failures and squash-merge the PR.

Do not report success until all three conditions hold: the PR is merged, issue #{issue['number']} is CLOSED, and project #{project['number']} item {issue['projectItemId']} has Status Done. After the merge and closure, set Done with:

{done}

Use Orca ask/reply for blocking questions. On an unrecoverable failure, report exact evidence and leave the worktree intact. Send exactly one dispatch-scoped worker_done from this terminal for the active taskId/dispatchId, only after success or unrecoverable failure, then end your turn."""


def command(name: str, argv: list[str], *, mutates: bool, placeholders: list[str] | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"name": name, "argv": argv, "shell": shell_join(argv), "mutates": mutates}
    if placeholders:
        result["placeholders"] = placeholders
    return result


def render(scan: dict[str, Any], workspace: Path, orca_command: str, repo_selector: str | None) -> dict[str, Any]:
    selected = scan.get("selectedIssue")
    if not selected:
        raise ValueError("scan has no selectedIssue")
    default_branch = scan.get("repository", {}).get("defaultBranch")
    if not default_branch:
        raise ValueError("scan repository has no defaultBranch")

    orca = shlex.split(orca_command)
    if not orca:
        raise ValueError("empty Orca command")
    selector = repo_selector or f"path:{workspace.resolve()}"
    name = issue_slug(selected["number"], selected["title"])
    spec = worker_spec(scan)
    worktree = "id:<worktree.id-from-create>"
    terminal = "<terminal.handle-from-create>"
    task = "<task.id-from-create>"

    commands = [
        command("orca-preflight", [*orca, "status", "--json"], mutates=False),
        command("mark-in-progress", status_command(scan, "In Progress"), mutates=True),
        command(
            "create-independent-worktree",
            [
                *orca,
                "worktree",
                "create",
                "--repo",
                selector,
                "--name",
                name,
                "--no-parent",
                "--base-branch",
                f"origin/{default_branch}",
                "--issue",
                str(selected["number"]),
                "--json",
            ],
            mutates=True,
        ),
        command(
            "launch-codex",
            [
                *orca,
                "terminal",
                "create",
                "--worktree",
                worktree,
                "--title",
                name,
                "--command",
                "codex --model gpt-5.6-terra",
                "--json",
            ],
            mutates=True,
            placeholders=["worktree.id-from-create"],
        ),
        command(
            "create-task",
            [*orca, "orchestration", "task-create", "--spec", spec, "--json"],
            mutates=True,
        ),
        command(
            "wait-for-tui",
            [*orca, "terminal", "wait", "--terminal", terminal, "--for", "tui-idle", "--timeout-ms", "60000", "--json"],
            mutates=False,
            placeholders=["terminal.handle-from-create"],
        ),
        command(
            "dispatch-with-preamble",
            [*orca, "orchestration", "dispatch", "--task", task, "--to", terminal, "--inject", "--json"],
            mutates=True,
            placeholders=["task.id-from-create", "terminal.handle-from-create"],
        ),
        command(
            "verify-dispatch",
            [*orca, "orchestration", "dispatch-show", "--task", task, "--json"],
            mutates=False,
            placeholders=["task.id-from-create"],
        ),
        command(
            "rolling-wait",
            [
                *orca,
                "orchestration",
                "check",
                "--wait",
                "--types",
                "worker_done,escalation,decision_gate",
                "--timeout-ms",
                "900000",
                "--json",
            ],
            mutates=False,
        ),
        command(
            "verify-issue-closed",
            ["gh", "issue", "view", str(selected["number"]), "--repo", scan["repository"]["nameWithOwner"], "--json", "state,url"],
            mutates=False,
        ),
        command(
            "verify-project-done",
            [
                "gh",
                "api",
                "graphql",
                "-F",
                f"itemId={selected['projectItemId']}",
                "-f",
                'query=query($itemId:ID!){node(id:$itemId){... on ProjectV2Item{id fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name optionId}}}}}',
            ],
            mutates=False,
        ),
        command("failure-only-mark-failed", status_command(scan, "Failed"), mutates=True),
    ]
    return {
        "dryRun": True,
        "executesCommands": False,
        "selectedIssue": selected,
        "workerSpec": spec,
        "commands": commands,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scan", type=Path, required=True, help="scanner JSON file")
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument("--orca", default="orca", help="resolved Orca CLI command")
    parser.add_argument("--repo-selector", help="Orca repository selector")
    parser.add_argument("--pretty", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    try:
        scan = json.loads(args.scan.read_text(encoding="utf-8"))
        result = render(scan, args.workspace, args.orca, args.repo_selector)
        json.dump(result, sys.stdout, indent=2 if args.pretty else None, sort_keys=args.pretty)
        sys.stdout.write("\n")
        return 0
    except (KeyError, OSError, json.JSONDecodeError, ValueError) as error:
        json.dump({"error": str(error)}, sys.stderr)
        sys.stderr.write("\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
