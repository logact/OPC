#!/usr/bin/env python3
"""Deterministic tests for the scanner and orchestration dry-run renderer."""

from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
FIXTURE_PATH = SCRIPT_DIR / "fixtures" / "project_snapshot.json"
sys.path.insert(0, str(SCRIPT_DIR))

import render_orchestration_plan as planner  # noqa: E402
import scan_iteration_issues as scanner  # noqa: E402


def load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def scan_fixture(fixture: dict, *, project_number: int | None = None, today: date = date(2026, 8, 8)) -> dict:
    project, field, iteration = scanner.select_active_project(
        fixture["projects"], today, project_number
    )
    return scanner.build_scan(
        repository=fixture["repository"],
        project=project,
        iteration_field=field,
        iteration=iteration,
        project_data=fixture["projectData"][str(project["number"])],
        today=today,
        resolve_dependency=scanner.fixture_resolver(fixture),
    )


class DependencyParsingTests(unittest.TestCase):
    def test_parses_only_explicit_declarations_and_sections(self) -> None:
        body = """Relates to #1 and composes with acme/widget#9.
> Depends on #2 and other/repo#3.

## Blocked by

- https://github.com/tools/lib/issues/4
- #5 (required)

## Notes
#6 is ordinary prose.
"""
        refs = scanner.parse_body_dependencies(body, "acme/widget")
        self.assertEqual(
            [ref["key"] for ref in refs],
            ["acme/widget#2", "other/repo#3", "tools/lib#4", "acme/widget#5"],
        )

    def test_live_style_depends_on_heading(self) -> None:
        body = "## Depends on\n\n- #108 (read cursor model)\n"
        self.assertEqual(
            scanner.parse_body_dependencies(body, "logact/OPC")[0]["key"],
            "logact/opc#108",
        )

    def test_non_dependency_relation_on_same_line_is_excluded(self) -> None:
        body = "> **Depends on:** #130 and #131; relates to #132 and composes with #133"
        self.assertEqual(
            [ref["key"] for ref in scanner.parse_body_dependencies(body, "logact/OPC")],
            ["logact/opc#130", "logact/opc#131"],
        )


class ProjectSelectionTests(unittest.TestCase):
    def test_iteration_uses_half_open_date_range(self) -> None:
        iteration = {"startDate": "2026-08-07", "duration": 2}
        self.assertTrue(scanner.iteration_is_active(iteration, date(2026, 8, 7)))
        self.assertTrue(scanner.iteration_is_active(iteration, date(2026, 8, 8)))
        self.assertFalse(scanner.iteration_is_active(iteration, date(2026, 8, 9)))

    def test_ambiguous_projects_require_number(self) -> None:
        fixture = load_fixture()
        duplicate = copy.deepcopy(fixture["projects"][0])
        duplicate.update({"id": "PVT_project_6", "number": 6, "title": "Other"})
        projects = [fixture["projects"][0], duplicate]
        with self.assertRaisesRegex(scanner.ScanError, "pass --project-number"):
            scanner.select_active_project(projects, date(2026, 8, 8), None)
        selected, _, _ = scanner.select_active_project(projects, date(2026, 8, 8), 5)
        self.assertEqual(selected["number"], 5)

    def test_no_active_iteration_is_an_error(self) -> None:
        with self.assertRaisesRegex(scanner.ScanError, "no active"):
            scanner.select_active_project(load_fixture()["projects"], date(2026, 8, 20), None)


class DagTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = load_fixture()
        self.result = scan_fixture(self.fixture)
        self.nodes = {node["key"]: node for node in self.result["nodes"]}

    def test_priority_milestone_due_date_and_issue_number_order(self) -> None:
        self.assertEqual(
            [issue["number"] for issue in self.result["executableIssues"]],
            [10, 12, 13, 22],
        )
        self.assertEqual(self.result["selectedIssue"]["number"], 10)

    def test_all_priority_bands_and_dated_milestones_sort_deterministically(self) -> None:
        nodes = [
            {"repository": "acme/widget", "number": number, "priority": priority, "milestone": milestone}
            for number, priority, milestone in (
                (9, None, None),
                (8, "Low", None),
                (7, "Medium", None),
                (6, "High", {"title": "later", "dueOn": "2026-09-02"}),
                (5, "High", {"title": "sooner", "dueOn": "2026-09-01"}),
                (4, "Urgent", None),
            )
        ]
        self.assertEqual(
            [node["number"] for node in sorted(nodes, key=lambda node: scanner.rank_key(node))],
            [4, 5, 6, 7, 8, 9],
        )

    def test_native_and_body_edges_are_combined(self) -> None:
        edge = next(edge for edge in self.result["edges"] if edge["to"] == "acme/widget#10")
        self.assertEqual(edge["sources"], ["body", "native"])
        self.assertTrue(edge["satisfied"])

    def test_open_and_unavailable_dependencies_block(self) -> None:
        self.assertEqual(
            self.nodes["acme/widget#14"]["blockingReasons"][0]["code"],
            "dependency_open",
        )
        self.assertEqual(
            self.nodes["acme/widget#11"]["blockingReasons"][0]["code"],
            "dependency_unavailable",
        )

    def test_cross_repository_closed_dependency_is_satisfied(self) -> None:
        edge = next(edge for edge in self.result["edges"] if edge["from"] == "widgets/library#7")
        self.assertTrue(edge["satisfied"])
        self.assertTrue(self.nodes["acme/widget#22"]["executable"])

    def test_cycles_are_reported_and_blocked(self) -> None:
        self.assertEqual(self.result["cycles"], [["acme/widget#20", "acme/widget#21"]])
        for number in (20, 21):
            codes = {reason["code"] for reason in self.nodes[f"acme/widget#{number}"]["blockingReasons"]}
            self.assertIn("dependency_cycle", codes)

    def test_empty_ready_set_is_successful_output(self) -> None:
        fixture = copy.deepcopy(self.fixture)
        for item in fixture["projectData"]["5"]["items"]:
            if item["fieldValues"].get("PVTSSF_status", {}).get("name") == "Todo":
                item["content"]["state"] = "CLOSED"
        result = scan_fixture(fixture)
        self.assertIsNone(result["selectedIssue"])
        self.assertEqual(result["executableIssues"], [])

    def test_output_is_deterministic(self) -> None:
        self.assertEqual(self.result, scan_fixture(copy.deepcopy(self.fixture)))

    def test_cli_reads_mocked_snapshot(self) -> None:
        process = subprocess.run(
            [
                sys.executable,
                str(SCRIPT_DIR / "scan_iteration_issues.py"),
                "--fixture",
                str(FIXTURE_PATH),
                "--today",
                "2026-08-08",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(json.loads(process.stdout)["selectedIssue"]["number"], 10)


class OrchestrationPlanTests(unittest.TestCase):
    def test_renderer_is_dry_run_and_preserves_codex_security_defaults(self) -> None:
        result = planner.render(scan_fixture(load_fixture()), Path("/tmp/widget"), "orca", None)
        self.assertTrue(result["dryRun"])
        self.assertFalse(result["executesCommands"])
        launch = next(command for command in result["commands"] if command["name"] == "launch-codex")
        command_value = launch["argv"][launch["argv"].index("--command") + 1]
        self.assertEqual(command_value, "codex --model gpt-5.6-terra")
        self.assertNotIn("dangerously", json.dumps(result))
        self.assertNotIn("bypass-approvals", json.dumps(result))

    def test_renderer_links_issue_uses_default_branch_and_injects_dispatch(self) -> None:
        result = planner.render(scan_fixture(load_fixture()), Path("/tmp/widget"), "orca", None)
        create = next(command for command in result["commands"] if command["name"] == "create-independent-worktree")
        self.assertIn("--no-parent", create["argv"])
        self.assertEqual(create["argv"][create["argv"].index("--base-branch") + 1], "origin/main")
        self.assertEqual(create["argv"][create["argv"].index("--issue") + 1], "10")
        dispatch = next(command for command in result["commands"] if command["name"] == "dispatch-with-preamble")
        self.assertIn("--inject", dispatch["argv"])

    def test_renderer_cli_never_executes_rendered_commands(self) -> None:
        scan = scan_fixture(load_fixture())
        with tempfile.TemporaryDirectory() as directory:
            scan_path = Path(directory) / "scan.json"
            scan_path.write_text(json.dumps(scan), encoding="utf-8")
            process = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_DIR / "render_orchestration_plan.py"),
                    "--scan",
                    str(scan_path),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertEqual(process.returncode, 0, process.stderr)
        output = json.loads(process.stdout)
        self.assertTrue(output["dryRun"])
        self.assertTrue(any(command["mutates"] for command in output["commands"]))


if __name__ == "__main__":
    unittest.main()
