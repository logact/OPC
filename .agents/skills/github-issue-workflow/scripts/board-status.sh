#!/usr/bin/env bash
# board-status.sh — set an issue's Status on a GitHub Projects V2 board (best-effort).
#
# Usage: board-status.sh <owner> <projectNumber> <repo> <issue> <status>
#   e.g.: board-status.sh logact 1 logact/OPC 4 "In Progress"
#
# Resolves the project (user-owned, then org-owned) -> Status field + option
# id -> the board item linked to the issue -> updateProjectV2ItemFieldValue.
#
# Exit codes:
#   0  status set, OR skipped gracefully (missing token scope, board/item/
#      option not found) — board mirroring must never block the workflow
#   1  unexpected error

set -u

if [ $# -ne 5 ]; then
  echo "usage: board-status.sh <owner> <projectNumber> <repo> <issue> <status>" >&2
  exit 64
fi

OWNER=$1; NUMBER=$2; REPO=$3; ISSUE=$4; STATUS=$5
SCOPE_HINT="hint: board mirroring needs the project token scope — run: gh auth refresh -s project"
ERR=$(mktemp)
trap 'rm -f "$ERR"' EXIT

is_scope_error() { grep -qiE 'scope|INSUFFICIENT_SCOPES' "$ERR"; }

project_query() { # <user|organization>
  cat <<EOF
query(\$owner: String!, \$number: Int!) {
  $1(login: \$owner) {
    projectV2(number: \$number) {
      id
      field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
    }
  }
}
EOF
}

items_query() { # <user|organization>
  cat <<EOF
query(\$owner: String!, \$number: Int!, \$cursor: String) {
  $1(login: \$owner) {
    projectV2(number: \$number) {
      items(first: 100, after: \$cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id content { ... on Issue { number repository { nameWithOwner } } } }
      }
    }
  }
}
EOF
}

# ---- 1. resolve the board (user first, then org) --------------------------
# one call per scope; jq emits: ["project", id, fieldId] then ["option", name, id]*
SCOPE="" PROJECT_ID="" FIELD_ID="" OPTION_ID=""
for scope in user organization; do
  if ! out=$(gh api graphql -f query="$(project_query "$scope")" -F owner="$OWNER" -F number="$NUMBER" \
        --jq ".data.$scope.projectV2 as \$p | select(\$p != null) | ([\"project\", \$p.id, (\$p.field.id // \"\")] | @tsv), (\$p.field.options[]? | [\"option\", .name, .id] | @tsv)" \
        2>"$ERR"); then
    if is_scope_error; then
      echo "board-status: cannot read board (token scope). $SCOPE_HINT" >&2
      exit 0
    fi
    continue
  fi
  [ -z "$out" ] && continue
  SCOPE=$scope
  PROJECT_ID=$(printf '%s\n' "$out" | awk -F '\t' '$1 == "project" { print $2 }')
  FIELD_ID=$(printf '%s\n' "$out" | awk -F '\t' '$1 == "project" { print $3 }')
  OPTION_ID=$(printf '%s\n' "$out" | awk -F '\t' -v s="$STATUS" '$1 == "option" && $2 == s { print $3 }')
  break
done

if [ -z "$PROJECT_ID" ]; then
  echo "board-status: board #$NUMBER not found for $OWNER (user or org) — skipping" >&2
  exit 0
fi
if [ -z "$FIELD_ID" ] || [ -z "$OPTION_ID" ]; then
  echo "board-status: board #$NUMBER has no Status option \"$STATUS\" — skipping" >&2
  exit 0
fi

# ---- 2. find the item id for this issue (paginated) -----------------------
# jq emits ["item", id, number, repo]* then ["page", hasNextPage, endCursor]
ITEM_ID="" CURSOR=""
for _ in $(seq 1 10); do
  if [ -z "$CURSOR" ]; then
    page=$(gh api graphql -f query="$(items_query "$SCOPE")" -F owner="$OWNER" -F number="$NUMBER" \
      --jq ".data.$SCOPE.projectV2.items as \$i | (\$i.nodes[] | [\"item\", .id, (.content.number // 0), (.content.repository.nameWithOwner // \"\")] | @tsv), (\$i.pageInfo | [\"page\", .hasNextPage, (.endCursor // \"\")] | @tsv)" \
      2>"$ERR") || break
  else
    page=$(gh api graphql -f query="$(items_query "$SCOPE")" -F owner="$OWNER" -F number="$NUMBER" -F cursor="$CURSOR" \
      --jq ".data.$SCOPE.projectV2.items as \$i | (\$i.nodes[] | [\"item\", .id, (.content.number // 0), (.content.repository.nameWithOwner // \"\")] | @tsv), (\$i.pageInfo | [\"page\", .hasNextPage, (.endCursor // \"\")] | @tsv)" \
      2>"$ERR") || break
  fi
  ITEM_ID=$(printf '%s\n' "$page" | awk -F '\t' -v repo="$REPO" -v issue="$ISSUE" \
    '$1 == "item" && tolower($4) == tolower(repo) && $3 == issue { print $2 }' | head -1)
  [ -n "$ITEM_ID" ] && break
  next=$(printf '%s\n' "$page" | awk -F '\t' '$1 == "page" && $2 == "true" { print $3 }')
  [ -z "$next" ] && break
  CURSOR=$next
done

if [ -z "$ITEM_ID" ]; then
  echo "board-status: issue $REPO#$ISSUE is not an item on board #$NUMBER — skipping" >&2
  exit 0
fi

# ---- 3. set the Status -----------------------------------------------------
MUTATION='mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
    value: { singleSelectOptionId: $optionId }
  }) { projectV2Item { id } }
}'

if ! gh api graphql -f query="$MUTATION" \
      -F projectId="$PROJECT_ID" -F itemId="$ITEM_ID" -F fieldId="$FIELD_ID" -F optionId="$OPTION_ID" \
      >/dev/null 2>"$ERR"; then
  if is_scope_error; then
    echo "board-status: cannot update board (token scope). $SCOPE_HINT" >&2
    exit 0
  fi
  echo "board-status: update failed: $(cat "$ERR")" >&2
  exit 1
fi

echo "board-status: $REPO#$ISSUE -> \"$STATUS\" on board #$NUMBER"
