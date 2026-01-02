#!/usr/bin/env bash
#
# ocdc-poll-filter.bash - Repo filter matching for poll items
#
# Matches items against repo_filters to determine which local repository
# to use. Uses specificity-based matching (more criteria = higher priority).
#
# Usage:
#   source "$(dirname "$0")/ocdc-poll-filter.bash"
#   repo_path=$(poll_config_match_repo_filter "$item_json" "$filters_json")

# Prevent multiple sourcing
[[ -n "${_OCDC_POLL_FILTER_LOADED:-}" ]] && return 0
_OCDC_POLL_FILTER_LOADED=1

# =============================================================================
# Repo Filter Matching
# =============================================================================

# Match an item against repo filters and return the matching repo_path
# Returns empty string if no match (caller should skip item)
#
# Matching criteria (all case-insensitive):
#   - team: Linear team key
#   - labels: Item has ANY of the specified labels
#   - repo: GitHub repository (owner/repo format)
#   - org: GitHub organization
#   - project: Project name
#   - milestone: Milestone name
#
# Specificity: More matching criteria = higher priority
# A filter with only repo_path acts as a catch-all (matches everything)
#
# Usage: poll_config_match_repo_filter '{"team":{"key":"ENG"}}' '[{"team":"ENG","repo_path":"~/code"}]'
poll_config_match_repo_filter() {
  local item_json="$1"
  local filters_json="$2"
  
  # Calculate specificity and find best match
  echo "$filters_json" | jq -r --argjson item "$item_json" '
    # Helper to check if item matches a filter (case-insensitive)
    def matches_filter:
      . as $filter |
      
      # Check team match (Linear)
      (if $filter.team then
        ($item.team.key // "" | ascii_downcase) == ($filter.team | ascii_downcase)
      else true end) and
      
      # Check labels match (any label matches)
      (if $filter.labels and ($filter.labels | length) > 0 then
        ($item.labels // []) | map(.name | ascii_downcase) | 
        any(. as $l | ($filter.labels | map(ascii_downcase)) | index($l))
      else true end) and
      
      # Check repo match (GitHub)
      (if $filter.repo then
        ($item.repository.full_name // $item.repo // "" | ascii_downcase) == ($filter.repo | ascii_downcase)
      else true end) and
      
      # Check org match (GitHub)
      (if $filter.org then
        ($item.repository.owner.login // "" | ascii_downcase) == ($filter.org | ascii_downcase)
      else true end) and
      
      # Check project match
      (if $filter.project then
        (($item.project.name // $item.project.title // "") | ascii_downcase) == ($filter.project | ascii_downcase)
      else true end) and
      
      # Check milestone match
      (if $filter.milestone then
        (($item.milestone.title // $item.milestone.name // "") | ascii_downcase) == ($filter.milestone | ascii_downcase)
      else true end);
    
    # Calculate specificity (count of non-null filter criteria)
    def specificity:
      [.team, .labels, .repo, .org, .project, .milestone] |
      map(select(. != null and . != [] and . != "")) |
      length;
    
    # Find matching filters with specificity
    [.[] | select(matches_filter) | {repo_path, specificity: specificity}] |
    
    # Sort by specificity descending, take first
    sort_by(-.specificity) |
    first |
    .repo_path // ""
  ' 2>/dev/null || echo ""
}
