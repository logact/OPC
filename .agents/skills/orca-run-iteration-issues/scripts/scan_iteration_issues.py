#!/usr/bin/env python3
"""Read-only GitHub Project iteration scanner.

The live path invokes only `gh repo view`, `gh api graphql`, and `gh issue view`.
Use --fixture for deterministic tests without contacting GitHub.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any


PRIORITY_RANK = {"Urgent": 0, "High": 1, "Medium": 2, "Low": 3}
REQUIRED_STATUSES = ("Todo", "In Progress", "Done", "Failed")
REFERENCE_RE = re.compile(
    r"https?://github\.com/(?P<url_owner>[A-Za-z0-9_.-]+)/"
    r"(?P<url_repo>[A-Za-z0-9_.-]+)/issues/(?P<url_number>\d+)"
    r"|(?<![A-Za-z0-9_.-])(?P<qualified_repo>[A-Za-z0-9_.-]+/"
    r"[A-Za-z0-9_.-]+)#(?P<qualified_number>\d+)"
    r"|(?<![A-Za-z0-9_/#-])#(?P<bare_number>\d+)",
    re.IGNORECASE,
)
DECLARATION_RE = re.compile(
    r"^(?:\*\*|__)?(?:depends\s+on|blocked\s+by)\b(?:\*\*|__)?\s*:?[ \t]*(.*)$",
    re.I,
)
NON_DEPENDENCY_RELATION_RE = re.compile(
    r"\b(?:and\s+)?(?:relates?\s+to|related\s+to|composes?\s+with|see\s+also|see)\b",
    re.I,
)


class ScanError(RuntimeError):
    """A conservative scanner failure that must prevent issue selection."""


def normalize_repo(value: str) -> str:
    value = value.strip().removesuffix(".git").rstrip("/")
    value = re.sub(r"^https?://github\.com/", "", value, flags=re.I)
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", value):
        raise ScanError(f"invalid repository {value!r}; expected OWNER/REPO")
    return value


def issue_key(repository: str, number: int) -> str:
    return f"{normalize_repo(repository).casefold()}#{int(number)}"


def display_key(repository: str, number: int) -> str:
    return f"{normalize_repo(repository)}#{int(number)}"


def parse_references(fragment: str, current_repo: str) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for match in REFERENCE_RE.finditer(fragment):
        if match.group("url_number"):
            repository = f"{match.group('url_owner')}/{match.group('url_repo')}"
            number = int(match.group("url_number"))
        elif match.group("qualified_number"):
            repository = match.group("qualified_repo")
            number = int(match.group("qualified_number"))
        else:
            repository = current_repo
            number = int(match.group("bare_number"))
        key = issue_key(repository, number)
        if key not in seen:
            seen.add(key)
            refs.append({"repository": normalize_repo(repository), "number": number, "key": key})
    return refs


def parse_body_dependencies(body: str, current_repo: str) -> list[dict[str, Any]]:
    """Parse only declaration lines/sections, not incidental issue references."""

    refs: list[dict[str, Any]] = []
    in_dependency_block = False
    block_has_reference = False

    for raw_line in body.splitlines():
        stripped = raw_line.strip()
        without_quote = re.sub(r"^(?:>\s*)+", "", stripped)
        is_heading = bool(re.match(r"^#{1,6}\s+", without_quote))
        declaration_text = re.sub(r"^#{1,6}\s+", "", without_quote)
        declaration_text = re.sub(r"^(?:[-*+]\s+)", "", declaration_text)
        declaration = DECLARATION_RE.match(declaration_text)

        if declaration:
            dependency_fragment = NON_DEPENDENCY_RELATION_RE.split(declaration.group(1), maxsplit=1)[0]
            found = parse_references(dependency_fragment, current_repo)
            refs.extend(found)
            in_dependency_block = is_heading or not found
            block_has_reference = bool(found)
            continue

        if not in_dependency_block:
            continue
        if not stripped:
            continue
        if is_heading:
            in_dependency_block = False
            continue

        is_list_item = bool(re.match(r"^(?:[-*+]\s+)", without_quote))
        found = parse_references(without_quote, current_repo)
        if found and (is_list_item or not block_has_reference):
            refs.extend(found)
            block_has_reference = True
            continue
        in_dependency_block = False

    deduped: dict[str, dict[str, Any]] = {}
    for ref in refs:
        deduped.setdefault(ref["key"], ref)
    return list(deduped.values())


def parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def iteration_is_active(iteration: dict[str, Any], today: date) -> bool:
    start = parse_iso_date(iteration.get("startDate"))
    duration = iteration.get("duration")
    return bool(start and isinstance(duration, int) and duration > 0 and start <= today < start + timedelta(days=duration))


def active_matches(project: dict[str, Any], today: date) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    if project.get("closed"):
        return matches
    for field in project.get("iterationFields", []):
        for iteration in field.get("iterations", []):
            if iteration_is_active(iteration, today):
                matches.append({"field": field, "iteration": iteration})
    return matches


def select_active_project(
    projects: list[dict[str, Any]], today: date, project_number: int | None
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    scoped = [project for project in projects if project_number is None or project.get("number") == project_number]
    if project_number is not None and not scoped:
        raise ScanError(f"project #{project_number} is not linked to the repository")

    candidates: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for project in scoped:
        for match in active_matches(project, today):
            candidates.append((project, match))

    if not candidates:
        suffix = f" in project #{project_number}" if project_number is not None else ""
        raise ScanError(f"no active GitHub Project iteration for {today.isoformat()}{suffix}")
    if len(candidates) > 1:
        details = ", ".join(
            f"#{project['number']}:{match['field']['name']}/{match['iteration']['title']}"
            for project, match in candidates
        )
        if project_number is None:
            raise ScanError(f"ambiguous active project iterations ({details}); pass --project-number")
        raise ScanError(f"project #{project_number} has multiple active iteration fields ({details})")

    project, match = candidates[0]
    return project, match["field"], match["iteration"]


def normalize_state(value: Any) -> str:
    state = str(value or "UNKNOWN").upper()
    return state if state in {"OPEN", "CLOSED"} else "UNKNOWN"


def find_field(project_data: dict[str, Any], field_type: str, name: str) -> dict[str, Any] | None:
    matches = [
        field
        for field in project_data.get("fields", [])
        if field.get("type") == field_type and str(field.get("name", "")).casefold() == name.casefold()
    ]
    if len(matches) > 1:
        raise ScanError(f"project has multiple {name!r} {field_type} fields")
    return matches[0] if matches else None


def status_options(status_field: dict[str, Any]) -> dict[str, str]:
    options = {str(option["name"]): str(option["id"]) for option in status_field.get("options", [])}
    missing = [name for name in REQUIRED_STATUSES if name not in options]
    if missing:
        raise ScanError(f"Status field is missing required options: {', '.join(missing)}")
    return options


def field_value(item: dict[str, Any], field_id: str) -> dict[str, Any] | None:
    return item.get("fieldValues", {}).get(field_id)


def rank_key(node: dict[str, Any]) -> list[Any]:
    milestone = node.get("milestone")
    has_milestone = milestone is not None
    due = parse_iso_date(milestone.get("dueOn") if has_milestone else None)
    return [
        PRIORITY_RANK.get(node.get("priority"), len(PRIORITY_RANK)),
        0 if has_milestone else 1,
        0 if due else 1,
        due.isoformat() if due else "9999-12-31",
        node["number"],
        node["repository"].casefold(),
    ]


def strongly_connected_cycles(nodes: Iterable[str], edges: Iterable[tuple[str, str]]) -> list[list[str]]:
    adjacency = {node: [] for node in nodes}
    self_loops: set[str] = set()
    for source, target in edges:
        adjacency.setdefault(source, []).append(target)
        adjacency.setdefault(target, [])
        if source == target:
            self_loops.add(source)
    for neighbors in adjacency.values():
        neighbors.sort()

    index = 0
    stack: list[str] = []
    on_stack: set[str] = set()
    indices: dict[str, int] = {}
    lowlinks: dict[str, int] = {}
    components: list[list[str]] = []

    def visit(node: str) -> None:
        nonlocal index
        indices[node] = index
        lowlinks[node] = index
        index += 1
        stack.append(node)
        on_stack.add(node)
        for neighbor in adjacency[node]:
            if neighbor not in indices:
                visit(neighbor)
                lowlinks[node] = min(lowlinks[node], lowlinks[neighbor])
            elif neighbor in on_stack:
                lowlinks[node] = min(lowlinks[node], indices[neighbor])
        if lowlinks[node] == indices[node]:
            component: list[str] = []
            while True:
                member = stack.pop()
                on_stack.remove(member)
                component.append(member)
                if member == node:
                    break
            if len(component) > 1 or component[0] in self_loops:
                components.append(sorted(component))

    for node in sorted(adjacency):
        if node not in indices:
            visit(node)
    return sorted(components)


DependencyResolver = Callable[[str, int], dict[str, Any] | None]


def build_scan(
    *,
    repository: dict[str, Any],
    project: dict[str, Any],
    iteration_field: dict[str, Any],
    iteration: dict[str, Any],
    project_data: dict[str, Any],
    today: date,
    resolve_dependency: DependencyResolver,
) -> dict[str, Any]:
    repo_name = normalize_repo(repository["nameWithOwner"])
    status_field = find_field(project_data, "single_select", "Status")
    if status_field is None:
        raise ScanError("project has no single-select Status field")
    options = status_options(status_field)
    priority_field = find_field(project_data, "single_select", "priority")

    project_issue_cache: dict[str, dict[str, Any]] = {}
    for item in project_data.get("items", []):
        content = item.get("content") or {}
        if content.get("type") != "Issue":
            continue
        key = issue_key(content["repository"], content["number"])
        project_issue_cache[key] = {
            "state": normalize_state(content.get("state")),
            "url": content.get("url"),
            "title": content.get("title"),
        }

    candidates: dict[str, dict[str, Any]] = {}
    dependency_specs: dict[str, dict[str, dict[str, Any]]] = {}
    for item in project_data.get("items", []):
        content = item.get("content") or {}
        if content.get("type") != "Issue" or normalize_repo(content["repository"]).casefold() != repo_name.casefold():
            continue
        status_value = field_value(item, status_field["id"])
        iteration_value = field_value(item, iteration_field["id"])
        if not status_value or status_value.get("name") != "Todo":
            continue
        if not iteration_value or iteration_value.get("iterationId") != iteration.get("id"):
            continue

        key = issue_key(repo_name, content["number"])
        priority_value = field_value(item, priority_field["id"]) if priority_field else None
        node = {
            "key": display_key(repo_name, content["number"]),
            "repository": repo_name,
            "number": int(content["number"]),
            "title": content.get("title") or "",
            "url": content.get("url"),
            "state": normalize_state(content.get("state")),
            "kind": "candidate",
            "projectItemId": item["id"],
            "status": "Todo",
            "priority": priority_value.get("name") if priority_value else None,
            "milestone": content.get("milestone"),
        }
        candidates[key] = node
        dependency_specs[key] = {}

        for blocker in content.get("blockedBy", []):
            dep_key = issue_key(blocker["repository"], blocker["number"])
            spec = dependency_specs[key].setdefault(
                dep_key,
                {
                    "repository": normalize_repo(blocker["repository"]),
                    "number": int(blocker["number"]),
                    "sources": set(),
                    "knownStates": [],
                    "url": blocker.get("url"),
                },
            )
            spec["sources"].add("native")
            spec["knownStates"].append(normalize_state(blocker.get("state")))

        for body_ref in parse_body_dependencies(content.get("body") or "", repo_name):
            spec = dependency_specs[key].setdefault(
                body_ref["key"],
                {
                    "repository": body_ref["repository"],
                    "number": body_ref["number"],
                    "sources": set(),
                    "knownStates": [],
                    "url": None,
                },
            )
            spec["sources"].add("body")

    edge_rows: list[dict[str, Any]] = []
    dependency_nodes: dict[str, dict[str, Any]] = {}
    for target_key in sorted(dependency_specs):
        for dep_key, spec in sorted(dependency_specs[target_key].items()):
            known_states = [state for state in spec["knownStates"] if state != "UNKNOWN"]
            resolved = project_issue_cache.get(dep_key)
            if not known_states and resolved is None:
                resolved = resolve_dependency(spec["repository"], spec["number"])
            if known_states:
                state = "CLOSED" if all(value == "CLOSED" for value in known_states) else "OPEN"
            else:
                state = normalize_state((resolved or {}).get("state"))
            resolution_error = None
            if state == "UNKNOWN":
                resolution_error = (resolved or {}).get("resolutionError") or "missing_or_inaccessible"

            display = display_key(spec["repository"], spec["number"])
            existing_candidate = candidates.get(dep_key)
            dependency_nodes.setdefault(
                dep_key,
                existing_candidate
                or {
                    "key": display,
                    "repository": spec["repository"],
                    "number": spec["number"],
                    "title": (resolved or {}).get("title"),
                    "url": spec.get("url") or (resolved or {}).get("url"),
                    "state": state,
                    "kind": "dependency",
                },
            )
            edge_rows.append(
                {
                    "from": display,
                    "to": candidates[target_key]["key"],
                    "sources": sorted(spec["sources"]),
                    "dependencyState": state,
                    "satisfied": state == "CLOSED",
                    **({"resolutionError": resolution_error} if resolution_error else {}),
                }
            )

    key_by_display = {
        node["key"]: key for key, node in {**dependency_nodes, **candidates}.items()
    }
    graph_edges = [(key_by_display[edge["from"]], key_by_display[edge["to"]]) for edge in edge_rows]
    cycles_internal = strongly_connected_cycles(set(key_by_display.values()), graph_edges)
    cycles = [[({**dependency_nodes, **candidates})[key]["key"] for key in cycle] for cycle in cycles_internal]
    cycle_members = {member for cycle in cycles_internal for member in cycle}

    edges_by_target: dict[str, list[dict[str, Any]]] = {key: [] for key in candidates}
    for edge in edge_rows:
        edges_by_target[key_by_display[edge["to"]]].append(edge)

    for key, node in candidates.items():
        reasons: list[dict[str, Any]] = []
        if node["state"] != "OPEN":
            reasons.append({"code": "issue_closed", "state": node["state"]})
        for edge in sorted(edges_by_target[key], key=lambda value: value["from"].casefold()):
            if edge["satisfied"]:
                continue
            code = "dependency_open" if edge["dependencyState"] == "OPEN" else "dependency_unavailable"
            reason = {
                "code": code,
                "dependency": edge["from"],
                "state": edge["dependencyState"],
                "sources": edge["sources"],
            }
            if edge.get("resolutionError"):
                reason["detail"] = edge["resolutionError"]
            reasons.append(reason)
        if key in cycle_members:
            relevant_cycle = next(cycle for cycle in cycles if node["key"] in cycle)
            reasons.append({"code": "dependency_cycle", "members": relevant_cycle})
        node["blockingReasons"] = reasons
        node["executable"] = not reasons
        node["rankKey"] = rank_key(node)

    executable_nodes = sorted(
        (node for node in candidates.values() if node["executable"]), key=lambda node: tuple(node["rankKey"])
    )
    executable_issues = [
        {
            key: node.get(key)
            for key in (
                "key",
                "repository",
                "number",
                "title",
                "url",
                "priority",
                "milestone",
                "rankKey",
                "projectItemId",
            )
        }
        for node in executable_nodes
    ]

    all_nodes = {**dependency_nodes, **candidates}
    return {
        "schemaVersion": 1,
        "asOfDate": today.isoformat(),
        "repository": {
            "nameWithOwner": repo_name,
            "defaultBranch": repository.get("defaultBranch"),
        },
        "project": {
            "id": project["id"],
            "number": project["number"],
            "title": project.get("title"),
            "owner": project.get("owner"),
            "iterationField": {"id": iteration_field["id"], "name": iteration_field["name"]},
            "activeIteration": iteration,
            "statusField": {
                "id": status_field["id"],
                "name": status_field["name"],
                "options": options,
            },
        },
        "nodes": [all_nodes[key] for key in sorted(all_nodes)],
        "edges": sorted(edge_rows, key=lambda edge: (edge["to"].casefold(), edge["from"].casefold())),
        "cycles": cycles,
        "executableIssues": executable_issues,
        "selectedIssue": executable_issues[0] if executable_issues else None,
        "summary": {
            "todoIssues": len(candidates),
            "executableIssues": len(executable_issues),
            "blockedIssues": len(candidates) - len(executable_issues),
        },
    }


@dataclass
class GhClient:
    executable: str = "gh"

    def _json(self, args: list[str]) -> dict[str, Any]:
        process = subprocess.run(
            [self.executable, *args], capture_output=True, text=True, check=False
        )
        if process.returncode:
            detail = (process.stderr or process.stdout).strip()
            raise ScanError(f"{' '.join([self.executable, *args[:2]])} failed: {detail}")
        try:
            result = json.loads(process.stdout)
        except json.JSONDecodeError as error:
            raise ScanError(f"{self.executable} returned invalid JSON: {error}") from error
        if isinstance(result, dict) and result.get("errors"):
            raise ScanError(f"GitHub GraphQL error: {result['errors']}")
        return result

    def repository(self, override: str | None) -> dict[str, Any]:
        args = ["repo", "view"]
        if override:
            args.append(normalize_repo(override))
        args.extend(["--json", "nameWithOwner,defaultBranchRef"])
        result = self._json(args)
        return {
            "nameWithOwner": normalize_repo(result["nameWithOwner"]),
            "defaultBranch": (result.get("defaultBranchRef") or {}).get("name"),
        }

    def graphql(self, query: str, **variables: Any) -> dict[str, Any]:
        args = ["api", "graphql", "-f", f"query={query}"]
        for name, value in variables.items():
            if value is not None:
                args.extend(["-F" if isinstance(value, int) else "-f", f"{name}={value}"])
        return self._json(args).get("data") or {}

    def issue(self, repository: str, number: int) -> dict[str, Any] | None:
        try:
            result = self._json(
                ["issue", "view", str(number), "--repo", normalize_repo(repository), "--json", "state,title,url"]
            )
        except ScanError as error:
            return {"state": "UNKNOWN", "resolutionError": str(error)}
        return {
            "state": normalize_state(result.get("state")),
            "title": result.get("title"),
            "url": result.get("url"),
        }


DISCOVERY_QUERY = """
query($owner:String!,$name:String!,$cursor:String){
  repository(owner:$owner,name:$name){
    projectsV2(first:100,after:$cursor){
      nodes{
        id number title closed
        owner{__typename ... on User{login} ... on Organization{login}}
        fields(first:100){
          nodes{
            __typename
            ... on ProjectV2IterationField{
              id name
              configuration{
                iterations{id title startDate duration}
                completedIterations{id title startDate duration}
              }
            }
          }
          pageInfo{hasNextPage}
        }
      }
      pageInfo{hasNextPage endCursor}
    }
  }
}
"""

PROJECT_QUERY = """
query($projectId:ID!,$cursor:String){
  node(id:$projectId){
    ... on ProjectV2{
      id number title
      owner{__typename ... on User{login} ... on Organization{login}}
      fields(first:100){
        nodes{
          __typename
          ... on ProjectV2SingleSelectField{id name options{id name}}
          ... on ProjectV2IterationField{
            id name
            configuration{
              iterations{id title startDate duration}
              completedIterations{id title startDate duration}
            }
          }
        }
        pageInfo{hasNextPage}
      }
      items(first:100,after:$cursor){
        nodes{
          id
          fieldValues(first:100){
            nodes{
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue{
                name optionId field{... on ProjectV2FieldCommon{id name}}
              }
              ... on ProjectV2ItemFieldIterationValue{
                iterationId title startDate duration field{... on ProjectV2FieldCommon{id name}}
              }
            }
            pageInfo{hasNextPage}
          }
          content{
            __typename
            ... on Issue{
              id number title body url state repository{nameWithOwner}
              milestone{title dueOn}
              blockedBy(first:100){
                nodes{id number state url repository{nameWithOwner}}
                pageInfo{hasNextPage endCursor}
              }
            }
          }
        }
        pageInfo{hasNextPage endCursor}
      }
    }
  }
}
"""

BLOCKERS_QUERY = """
query($issueId:ID!,$cursor:String){
  node(id:$issueId){
    ... on Issue{
      blockedBy(first:100,after:$cursor){
        nodes{id number state url repository{nameWithOwner}}
        pageInfo{hasNextPage endCursor}
      }
    }
  }
}
"""


def owner_login(owner: dict[str, Any] | None) -> str | None:
    return (owner or {}).get("login")


def discover_projects(client: GhClient, repository: str) -> list[dict[str, Any]]:
    owner, name = normalize_repo(repository).split("/", 1)
    projects: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        connection = client.graphql(DISCOVERY_QUERY, owner=owner, name=name, cursor=cursor)["repository"]["projectsV2"]
        for raw in connection["nodes"]:
            if raw["fields"]["pageInfo"]["hasNextPage"]:
                raise ScanError(f"project #{raw['number']} has more than 100 fields")
            iteration_fields = []
            for field in raw["fields"]["nodes"]:
                if field.get("__typename") != "ProjectV2IterationField":
                    continue
                configuration = field.get("configuration") or {}
                iterations = [
                    *configuration.get("completedIterations", []),
                    *configuration.get("iterations", []),
                ]
                iteration_fields.append({"id": field["id"], "name": field["name"], "iterations": iterations})
            projects.append(
                {
                    "id": raw["id"],
                    "number": raw["number"],
                    "title": raw.get("title"),
                    "closed": raw.get("closed", False),
                    "owner": owner_login(raw.get("owner")),
                    "iterationFields": iteration_fields,
                }
            )
        if not connection["pageInfo"]["hasNextPage"]:
            return projects
        cursor = connection["pageInfo"]["endCursor"]


def normalize_blocker(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "repository": raw["repository"]["nameWithOwner"],
        "number": raw["number"],
        "state": raw.get("state"),
        "url": raw.get("url"),
    }


def collect_project_data(client: GhClient, project_id: str) -> dict[str, Any]:
    fields: list[dict[str, Any]] | None = None
    items: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        raw = client.graphql(PROJECT_QUERY, projectId=project_id, cursor=cursor)["node"]
        if raw["fields"]["pageInfo"]["hasNextPage"]:
            raise ScanError(f"project #{raw['number']} has more than 100 fields")
        if fields is None:
            fields = []
            for field in raw["fields"]["nodes"]:
                if field.get("__typename") == "ProjectV2SingleSelectField":
                    fields.append(
                        {
                            "type": "single_select",
                            "id": field["id"],
                            "name": field["name"],
                            "options": field.get("options", []),
                        }
                    )
                elif field.get("__typename") == "ProjectV2IterationField":
                    fields.append({"type": "iteration", "id": field["id"], "name": field["name"]})

        for raw_item in raw["items"]["nodes"]:
            if raw_item["fieldValues"]["pageInfo"]["hasNextPage"]:
                raise ScanError(f"project item {raw_item['id']} has more than 100 field values")
            values: dict[str, dict[str, Any]] = {}
            for value in raw_item["fieldValues"]["nodes"]:
                field = value.get("field") or {}
                if not field.get("id"):
                    continue
                if value.get("__typename") == "ProjectV2ItemFieldSingleSelectValue":
                    values[field["id"]] = {
                        "type": "single_select",
                        "name": value.get("name"),
                        "optionId": value.get("optionId"),
                    }
                elif value.get("__typename") == "ProjectV2ItemFieldIterationValue":
                    values[field["id"]] = {
                        "type": "iteration",
                        "iterationId": value.get("iterationId"),
                        "title": value.get("title"),
                        "startDate": value.get("startDate"),
                        "duration": value.get("duration"),
                    }

            content = raw_item.get("content") or {}
            normalized_content: dict[str, Any] = {"type": content.get("__typename")}
            if content.get("__typename") == "Issue":
                blockers_connection = content.get("blockedBy") or {"nodes": [], "pageInfo": {}}
                blockers = [normalize_blocker(blocker) for blocker in blockers_connection.get("nodes", [])]
                blocker_cursor = blockers_connection.get("pageInfo", {}).get("endCursor")
                while blockers_connection.get("pageInfo", {}).get("hasNextPage"):
                    blockers_connection = client.graphql(
                        BLOCKERS_QUERY, issueId=content["id"], cursor=blocker_cursor
                    )["node"]["blockedBy"]
                    blockers.extend(normalize_blocker(blocker) for blocker in blockers_connection["nodes"])
                    blocker_cursor = blockers_connection["pageInfo"]["endCursor"]
                normalized_content.update(
                    {
                        "id": content["id"],
                        "repository": content["repository"]["nameWithOwner"],
                        "number": content["number"],
                        "title": content.get("title"),
                        "body": content.get("body") or "",
                        "url": content.get("url"),
                        "state": content.get("state"),
                        "milestone": content.get("milestone"),
                        "blockedBy": blockers,
                    }
                )
            items.append({"id": raw_item["id"], "fieldValues": values, "content": normalized_content})

        if not raw["items"]["pageInfo"]["hasNextPage"]:
            return {"fields": fields or [], "items": items}
        cursor = raw["items"]["pageInfo"]["endCursor"]


def fixture_resolver(fixture: dict[str, Any]) -> DependencyResolver:
    states = {key.casefold(): value for key, value in fixture.get("dependencyStates", {}).items()}

    def resolve(repository: str, number: int) -> dict[str, Any] | None:
        value = states.get(issue_key(repository, number))
        if value is None:
            return {"state": "UNKNOWN", "resolutionError": "missing_or_inaccessible"}
        if isinstance(value, str):
            return {"state": value}
        return value

    return resolve


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", help="OWNER/REPO; defaults to the current repository")
    parser.add_argument("--project-number", type=int, help="disambiguate the active linked project")
    parser.add_argument("--today", type=date.fromisoformat, default=date.today(), help="YYYY-MM-DD")
    parser.add_argument("--fixture", type=Path, help="read a normalized mocked GitHub snapshot")
    parser.add_argument("--gh", default="gh", help="GitHub CLI executable")
    parser.add_argument("--pretty", action="store_true", help="indent JSON output")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    try:
        if args.fixture:
            fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
            repository = fixture["repository"]
            if args.repo and normalize_repo(args.repo).casefold() != normalize_repo(repository["nameWithOwner"]).casefold():
                raise ScanError("--repo does not match fixture repository")
            projects = fixture["projects"]
            project, iteration_field, iteration = select_active_project(projects, args.today, args.project_number)
            project_data = fixture["projectData"][str(project["number"])]
            resolver = fixture_resolver(fixture)
        else:
            client = GhClient(args.gh)
            repository = client.repository(args.repo)
            projects = discover_projects(client, repository["nameWithOwner"])
            project, iteration_field, iteration = select_active_project(projects, args.today, args.project_number)
            project_data = collect_project_data(client, project["id"])
            resolver = client.issue

        result = build_scan(
            repository=repository,
            project=project,
            iteration_field=iteration_field,
            iteration=iteration,
            project_data=project_data,
            today=args.today,
            resolve_dependency=resolver,
        )
        json.dump(result, sys.stdout, indent=2 if args.pretty else None, sort_keys=args.pretty)
        sys.stdout.write("\n")
        return 0
    except (KeyError, OSError, json.JSONDecodeError, ScanError) as error:
        json.dump({"error": str(error)}, sys.stderr)
        sys.stderr.write("\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
