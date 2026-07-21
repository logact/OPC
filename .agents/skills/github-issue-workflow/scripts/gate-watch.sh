#!/usr/bin/env bash
# gate-watch.sh — evaluate or wait on a human gate in GitHub issue comments.
#
# Usage: gate-watch.sh <repo> <issue> <marker> <approver1,approver2,...> [--wait <seconds>]
#
# Semantics (mirrors src/gates.ts evaluateGate):
#   - find the NEWEST comment containing <marker> (a plain substring, e.g. "gate:align")
#   - among comments AFTER it authored by an approver (case-insensitive), take the newest
#   - that comment matching /^\/(approve|lgtm)\b/i  => approved
#   - any other newest approver comment             => feedback
#   - no marker / no approver comment yet           => pending
#
# Output / exit codes:
#   approved by <login>            exit 0
#   feedback from <login>: <body>  exit 1
#   pending                        exit 2
#
# --wait <seconds>: re-poll every 30s until approved/feedback or the deadline;
# on deadline the last result is printed (exit 2 = still pending).

set -u

if [ $# -lt 4 ]; then
  echo "usage: gate-watch.sh <repo> <issue> <marker> <approver1,approver2,...> [--wait <seconds>]" >&2
  exit 64
fi

REPO=$1; ISSUE=$2; MARKER=$3; APPROVERS=$4; shift 4
WAIT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --wait) WAIT=${2:?--wait needs seconds}; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 64 ;;
  esac
done

APPROVAL_RE='^/(approve|lgtm)([[:space:]]|$)'

poll_once() {
  # manual pagination: gh --jq cannot be combined with --paginate/--slurp
  local lines="" page=1 chunk
  while [ "$page" -le 10 ]; do
    if ! chunk=$(gh api "repos/$REPO/issues/$ISSUE/comments?per_page=100&page=$page" \
          --jq '.[] | [.user.login, (.body | @base64)] | @tsv' 2>/dev/null); then
      echo "gate-watch: failed to list comments for $REPO#$ISSUE" >&2
      return 3
    fi
    [ -z "$chunk" ] && break
    lines="${lines}${chunk}"$'\n'
    [ "$(printf '%s\n' "$chunk" | wc -l)" -lt 100 ] && break
    page=$((page + 1))
  done

  # newest comment index containing the marker (1-based over the line list)
  local marker_ln=0 ln=0 login b64 body
  while IFS=$'\t' read -r login b64; do
    ln=$((ln + 1))
    body=$(printf '%s' "$b64" | base64 --decode 2>/dev/null)
    case "$body" in *"$MARKER"*) marker_ln=$ln ;; esac
  done <<< "$lines"
  if [ "$marker_ln" -eq 0 ]; then echo pending; return 2; fi

  # newest approver comment after the marker
  local newest_login="" newest_body=""
  ln=0
  while IFS=$'\t' read -r login b64; do
    ln=$((ln + 1))
    [ "$ln" -le "$marker_ln" ] && continue
    body=$(printf '%s' "$b64" | base64 --decode 2>/dev/null)
    # case-insensitive approver match on comma-separated list
    if printf ',%s,' "$(printf '%s' "$APPROVERS" | tr 'A-Z' 'a-z')" \
         | grep -q ",$(printf '%s' "$login" | tr 'A-Z' 'a-z'),"; then
      newest_login=$login; newest_body=$body
    fi
  done <<< "$lines"

  if [ -z "$newest_login" ]; then echo pending; return 2; fi
  if printf '%s' "$newest_body" | grep -qiE "$APPROVAL_RE"; then
    echo "approved by $newest_login"; return 0
  fi
  echo "feedback from $newest_login: $newest_body"; return 1
}

deadline=$(( $(date +%s) + WAIT ))
while true; do
  out=$(poll_once); rc=$?
  # rc 3 = transient API error: keep waiting if we have budget, else report it
  if [ "$rc" -ne 2 ] && [ "$rc" -ne 3 ]; then printf '%s\n' "$out"; exit "$rc"; fi
  if [ "$WAIT" -eq 0 ] || [ "$(date +%s)" -ge "$deadline" ]; then
    if [ "$rc" -eq 3 ]; then printf '%s\n' "$out" >&2; exit 3; fi
    printf '%s\n' "$out"; exit 2
  fi
  sleep 30
done
