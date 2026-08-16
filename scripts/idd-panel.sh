#!/usr/bin/env bash
# IDD interactive panel controller.
# Renders .config/opencode/panel.md and posts/updates the panel comment on a thread.
# Requires GH_TOKEN (or gh auth) and gh CLI.
#
# Usage:
#   idd-panel.sh post   <owner/repo> <number> [status]
#   idd-panel.sh reset  <owner/repo> <number> [status]
#   idd-panel.sh check  <owner/repo> <number> <cmd> [status]   # mark one box [x] + status
#   idd-panel.sh status <owner/repo> <number> <msg>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$ROOT/.config/opencode/panel.md"
MARKER="IDD-PANEL"

usage() {
  echo "usage: idd-panel.sh <post|reset|check|status> <owner/repo> <number> [cmd] [status]" >&2
  exit 2
}

action="${1:-}"
repo="${2:-}"
num="${3:-}"
[ -n "$action" ] && [ -n "$repo" ] && [ -n "$num" ] || usage

cmd=""
status="--"
case "$action" in
  post)   status="${4:---}" ;;
  reset)  status="${4:---}" ;;
  status) status="${4:?status message required}" ;;
  check)  cmd="${4:?command required}"; status="${5:---}" ;;
  *) usage ;;
esac

render() {
  awk -v checked="$cmd" -v st="$status" '
    /IDD-PANEL/ { print; next }
    /^### / { print; next }
    /^- \[/ {
      line = $0
      c = ""
      if (match(line, /\/[a-z-]+/)) c = substr(line, RSTART, RLENGTH)
      if (checked != "" && c == checked) sub(/^- \[ \]/, "- [x]", line)
      print line
      next
    }
    /^`Last run:/ { print "`Last run: " st "`"; next }
    { print }
  ' "$TEMPLATE"
}

find_panel_id() {
  gh api "repos/$repo/issues/$num/comments?per_page=100" \
    --jq ".[] | select(.body | contains(\"$MARKER\")) | .id" 2>/dev/null | head -1 || true
}

body="$(render)"
existing="$(find_panel_id)"
if [ -n "$existing" ]; then
  gh api -X PATCH "repos/$repo/issues/comments/$existing" \
    --input <(jq -n --arg b "$body" '{body:$b}') >/dev/null
else
  gh api -X POST "repos/$repo/issues/$num/comments" \
    --input <(jq -n --arg b "$body" '{body:$b}') >/dev/null
fi
echo "panel $action: $repo#$num"