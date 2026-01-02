#!/usr/bin/env bash
#
# ocdc-poll-fetch.bash - Fetch command building for poll sources
#
# Builds CLI commands to fetch items from various sources
# (Linear, GitHub Issues, GitHub PRs).
#
# Usage:
#   source "$(dirname "$0")/ocdc-poll-fetch.bash"
#   cmd=$(poll_config_build_fetch_command "github_issue" '{"repo":"org/repo"}')

# Prevent multiple sourcing
[[ -n "${_OCDC_POLL_FETCH_LOADED:-}" ]] && return 0
_OCDC_POLL_FETCH_LOADED=1

# Source defaults if not already loaded
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/ocdc-poll-defaults.bash"

# =============================================================================
# Shell Quoting
# =============================================================================

# Shell-quote a string for safe interpolation into a command
# Usage: _shell_quote "value with spaces"
_shell_quote() {
  printf '%q' "$1"
}

# =============================================================================
# Fetch Command Building
# =============================================================================

# Build fetch command from source type and fetch options
# Usage: poll_config_build_fetch_command "linear_issue" '{"assignee":"@me"}'
poll_config_build_fetch_command() {
  local source_type="$1"
  local fetch_options="${2:-}"
  
  # Merge with defaults
  local defaults
  defaults=$(poll_config_get_default_fetch_options "$source_type")
  
  if [[ -n "$fetch_options" ]] && [[ "$fetch_options" != "null" ]]; then
    fetch_options=$(echo "$defaults" | jq --argjson opts "$fetch_options" '. * $opts')
  else
    fetch_options="$defaults"
  fi
  
  case "$source_type" in
    linear_issue)
      _build_linear_fetch_command "$fetch_options"
      ;;
    github_issue)
      _build_github_issue_fetch_command "$fetch_options"
      ;;
    github_pr)
      _build_github_pr_fetch_command "$fetch_options"
      ;;
    *)
      echo "echo '[]'"
      ;;
  esac
}

# =============================================================================
# Source-Specific Builders
# =============================================================================

# Build Linear fetch command
_build_linear_fetch_command() {
  local opts="$1"
  local cmd="linear issue list"
  
  # Assignee
  local assignee
  assignee=$(echo "$opts" | jq -r '.assignee // "@me"')
  if [[ "$assignee" == "@me" ]]; then
    cmd="$cmd --mine"
  fi
  
  # State - Linear uses comma-separated
  local state
  state=$(echo "$opts" | jq -r 'if .state | type == "array" then .state | join(",") else .state // "started,unstarted" end')
  if [[ -n "$state" ]]; then
    cmd="$cmd --state $state"
  fi
  
  # Output as JSON
  cmd="$cmd --json"
  
  # Exclude labels - filter with jq after
  local exclude_labels
  exclude_labels=$(echo "$opts" | jq -c '.exclude_labels // []')
  if [[ "$exclude_labels" != "[]" ]]; then
    cmd="$cmd | jq '[.[] | select(.labels | map(.name) | any(. as \$l | $exclude_labels | index(\$l)) | not)]'"
  fi
  
  echo "$cmd"
}

# Build GitHub issue fetch command
_build_github_issue_fetch_command() {
  local opts="$1"
  local cmd="gh search issues"
  
  # Assignee - quote to prevent injection
  local assignee
  assignee=$(echo "$opts" | jq -r '.assignee // "@me"')
  cmd="$cmd --assignee=$(_shell_quote "$assignee")"
  
  # State - validate against known values
  local state
  state=$(echo "$opts" | jq -r '.state // "open"')
  case "$state" in
    open|closed|all) cmd="$cmd --state=$state" ;;
    *) cmd="$cmd --state=open" ;;  # Default to open for unknown values
  esac
  
  # Labels - quote to prevent injection
  local labels
  labels=$(echo "$opts" | jq -r '.labels // [] | if length > 0 then join(",") else empty end')
  if [[ -n "$labels" ]]; then
    cmd="$cmd --label=$(_shell_quote "$labels")"
  fi
  
  # Repo - quote to prevent injection
  local repo
  repo=$(echo "$opts" | jq -r '.repo // empty')
  if [[ -n "$repo" ]]; then
    cmd="$cmd --repo=$(_shell_quote "$repo")"
  fi
  
  # Org - quote to prevent injection
  local org
  org=$(echo "$opts" | jq -r '.org // empty')
  if [[ -n "$org" ]]; then
    cmd="$cmd --owner=$(_shell_quote "$org")"
  fi
  
  # JSON fields
  cmd="$cmd --json number,title,body,url,repository,labels,assignees"
  
  echo "$cmd"
}

# Build GitHub PR fetch command
_build_github_pr_fetch_command() {
  local opts="$1"
  local cmd="gh search prs"
  
  # Review requested - quote to prevent injection
  local review_requested
  review_requested=$(echo "$opts" | jq -r '.review_requested // "@me"')
  cmd="$cmd --review-requested=$(_shell_quote "$review_requested")"
  
  # State - validate against known values
  local state
  state=$(echo "$opts" | jq -r '.state // "open"')
  case "$state" in
    open|closed|all) cmd="$cmd --state=$state" ;;
    *) cmd="$cmd --state=open" ;;  # Default to open for unknown values
  esac
  
  # Repo - quote to prevent injection
  local repo
  repo=$(echo "$opts" | jq -r '.repo // empty')
  if [[ -n "$repo" ]]; then
    cmd="$cmd --repo=$(_shell_quote "$repo")"
  fi
  
  # Org - quote to prevent injection
  local org
  org=$(echo "$opts" | jq -r '.org // empty')
  if [[ -n "$org" ]]; then
    cmd="$cmd --owner=$(_shell_quote "$org")"
  fi
  
  # JSON fields
  cmd="$cmd --json number,title,body,url,repository,labels,headRefName"
  
  echo "$cmd"
}
