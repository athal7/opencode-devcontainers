#!/usr/bin/env bash
#
# ocdc-poll-config.bash - Poll configuration management
#
# Main entry point for poll configuration. Sources modular components
# and provides config access, validation, and listing functions.
#
# Usage:
#   source "$(dirname "$0")/ocdc-poll-config.bash"
#   poll_config_validate "/path/to/config.yaml"
#
# Required: ruby (for YAML parsing), jq (for JSON manipulation)

# Prevent multiple sourcing
[[ -n "${_OCDC_POLL_CONFIG_LOADED:-}" ]] && return 0
_OCDC_POLL_CONFIG_LOADED=1

# =============================================================================
# Module Loading
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source paths for OCDC_POLLS_DIR if available
if [[ -z "${OCDC_POLLS_DIR:-}" ]]; then
  if [[ -f "${SCRIPT_DIR}/ocdc-paths.bash" ]]; then
    source "${SCRIPT_DIR}/ocdc-paths.bash"
  fi
  OCDC_POLLS_DIR="${OCDC_POLLS_DIR:-${OCDC_CONFIG_DIR:-$HOME/.config/ocdc}/polls}"
fi

# Source modular components
source "${SCRIPT_DIR}/ocdc-yaml.bash"
source "${SCRIPT_DIR}/ocdc-poll-defaults.bash"
source "${SCRIPT_DIR}/ocdc-poll-fetch.bash"
source "${SCRIPT_DIR}/ocdc-poll-filter.bash"

# =============================================================================
# Schema Validation
# =============================================================================

# Validate a poll configuration file against the JSON schema
# Requires: check-jsonschema (pip install check-jsonschema)
# Returns 0 if valid, 1 if invalid or tool not available
# Usage: poll_config_validate_schema "/path/to/config.yaml" "/path/to/schema.json"
poll_config_validate_schema() {
  local config_file="$1"
  local schema_file="${2:-}"
  
  # Find schema file if not provided
  if [[ -z "$schema_file" ]]; then
    schema_file="$(dirname "$SCRIPT_DIR")/share/ocdc/poll-config.schema.json"
  fi
  
  # Check if check-jsonschema is available
  if ! command -v check-jsonschema >/dev/null 2>&1; then
    echo "Warning: check-jsonschema not installed, skipping schema validation" >&2
    return 0
  fi
  
  # Check files exist
  if [[ ! -f "$config_file" ]]; then
    echo "Error: Config file not found: $config_file" >&2
    return 1
  fi
  
  if [[ ! -f "$schema_file" ]]; then
    echo "Warning: Schema file not found: $schema_file, skipping schema validation" >&2
    return 0
  fi
  
  # Run schema validation
  if ! check-jsonschema --schemafile "$schema_file" "$config_file" 2>&1; then
    return 1
  fi
  
  return 0
}

# Validate a poll configuration file (basic validation)
# Returns 0 if valid, 1 if invalid
# Usage: poll_config_validate "/path/to/config.yaml"
poll_config_validate() {
  local config_file="$1"
  local errors=()
  
  # Check file exists
  if [[ ! -f "$config_file" ]]; then
    echo "Error: Config file not found: $config_file" >&2
    return 1
  fi
  
  # Check YAML can be parsed
  if ! _yaml_to_json "$config_file" > /dev/null 2>&1; then
    echo "Error: Failed to parse YAML: $config_file" >&2
    return 1
  fi
  
  # Required: id
  local id
  id=$(_yaml_get "$config_file" ".id")
  if [[ -z "$id" ]]; then
    errors+=("Missing required field: id")
  fi
  
  # Required: source_type (must be one of the valid types)
  local source_type
  source_type=$(_yaml_get "$config_file" ".source_type")
  if [[ -z "$source_type" ]]; then
    errors+=("Missing required field: source_type")
  elif [[ "$source_type" != "linear_issue" ]] && [[ "$source_type" != "github_issue" ]] && [[ "$source_type" != "github_pr" ]]; then
    errors+=("Invalid source_type: $source_type (must be linear_issue, github_issue, or github_pr)")
  fi
  
  # Required: repo_filters (must be non-empty array)
  local repo_filters_count
  repo_filters_count=$(_yaml_get "$config_file" ".repo_filters | length")
  if [[ -z "$repo_filters_count" ]] || [[ "$repo_filters_count" == "0" ]]; then
    errors+=("Missing or empty required field: repo_filters")
  fi
  
  # Each repo_filter must have repo_path
  local missing_paths
  missing_paths=$(_yaml_get "$config_file" '[.repo_filters[] | select(.repo_path == null or .repo_path == "")] | length')
  if [[ -n "$missing_paths" ]] && [[ "$missing_paths" != "0" ]]; then
    errors+=("All repo_filters must have repo_path")
  fi
  
  # Mutual exclusion: fetch and fetch_command
  local has_fetch has_fetch_command
  has_fetch=$(_yaml_get "$config_file" ".fetch")
  has_fetch_command=$(_yaml_get "$config_file" ".fetch_command")
  if [[ -n "$has_fetch" ]] && [[ -n "$has_fetch_command" ]]; then
    errors+=("fetch and fetch_command are mutually exclusive")
  fi
  
  # If prompt.file is specified, check it exists (relative to config dir)
  local prompt_file
  prompt_file=$(_yaml_get "$config_file" ".prompt.file")
  if [[ -n "$prompt_file" ]]; then
    local config_dir
    config_dir=$(dirname "$config_file")
    local full_prompt_path="$config_dir/$prompt_file"
    if [[ ! -f "$full_prompt_path" ]]; then
      errors+=("Prompt file not found: $prompt_file (looked in $full_prompt_path)")
    fi
  fi
  
  # Report errors
  if [[ ${#errors[@]} -gt 0 ]]; then
    echo "Validation errors in $config_file:" >&2
    for error in "${errors[@]}"; do
      echo "  - $error" >&2
    done
    return 1
  fi
  
  return 0
}

# =============================================================================
# Config Access Functions
# =============================================================================

# Get a field from a poll config file
# Usage: poll_config_get "/path/to/config.yaml" ".field.path"
poll_config_get() {
  local config_file="$1"
  local jq_path="$2"
  
  _yaml_get "$config_file" "$jq_path"
}

# Get a field from a poll config with a default value
# Usage: poll_config_get_with_default "/path/to/config.yaml" ".field" "default"
poll_config_get_with_default() {
  local config_file="$1"
  local jq_path="$2"
  local default="$3"
  
  _yaml_get_default "$config_file" "$jq_path" "$default"
}

# Get repo filters as JSON
# Usage: poll_config_get_repo_filters "/path/to/config.yaml"
poll_config_get_repo_filters() {
  local config_file="$1"
  _yaml_to_json "$config_file" | jq -c '.repo_filters // []'
}

# =============================================================================
# Effective Config (with defaults)
# =============================================================================

# Get the effective fetch command (built from fetch options or fetch_command)
# Usage: poll_config_get_effective_fetch_command "/path/to/config.yaml"
poll_config_get_effective_fetch_command() {
  local config_file="$1"
  
  # Check for explicit fetch_command first
  local fetch_command
  fetch_command=$(_yaml_get "$config_file" ".fetch_command")
  if [[ -n "$fetch_command" ]]; then
    echo "$fetch_command"
    return 0
  fi
  
  # Build from source_type and fetch options
  local source_type fetch_options
  source_type=$(_yaml_get "$config_file" ".source_type")
  fetch_options=$(_yaml_to_json "$config_file" | jq -c '.fetch // null')
  
  poll_config_build_fetch_command "$source_type" "$fetch_options"
}

# Get the effective item mapping (merged with defaults)
# Usage: poll_config_get_effective_item_mapping "/path/to/config.yaml"
poll_config_get_effective_item_mapping() {
  local config_file="$1"
  
  local source_type
  source_type=$(_yaml_get "$config_file" ".source_type")
  
  local defaults
  defaults=$(poll_config_get_default_item_mapping "$source_type")
  
  local custom
  custom=$(_yaml_to_json "$config_file" | jq -c '.item_mapping // {}')
  
  # Merge custom over defaults
  echo "$defaults" | jq --argjson custom "$custom" '. * $custom'
}

# Get the effective prompt template (or default)
# Usage: poll_config_get_effective_prompt "/path/to/config.yaml"
poll_config_get_effective_prompt() {
  local config_file="$1"
  
  # Check for inline template first
  local template
  template=$(_yaml_get "$config_file" ".prompt.template")
  if [[ -n "$template" ]]; then
    echo "$template"
    return 0
  fi
  
  # Check for file reference
  local prompt_file
  prompt_file=$(_yaml_get "$config_file" ".prompt.file")
  if [[ -n "$prompt_file" ]]; then
    local config_dir
    config_dir=$(dirname "$config_file")
    local full_path="$config_dir/$prompt_file"
    if [[ -f "$full_path" ]]; then
      cat "$full_path"
      return 0
    fi
  fi
  
  # Return default
  local source_type
  source_type=$(_yaml_get "$config_file" ".source_type")
  poll_config_get_default_prompt "$source_type"
}

# Get the effective session name template (or default)
# Usage: poll_config_get_effective_session_name "/path/to/config.yaml"
poll_config_get_effective_session_name() {
  local config_file="$1"
  
  local session_name
  session_name=$(_yaml_get "$config_file" ".session.name_template")
  if [[ -n "$session_name" ]]; then
    echo "$session_name"
    return 0
  fi
  
  local source_type
  source_type=$(_yaml_get "$config_file" ".source_type")
  poll_config_get_default_session_name "$source_type"
}

# Get the effective agent (or default)
# Usage: poll_config_get_effective_agent "/path/to/config.yaml"
poll_config_get_effective_agent() {
  local config_file="$1"
  
  local agent
  agent=$(_yaml_get "$config_file" ".session.agent")
  if [[ -n "$agent" ]]; then
    echo "$agent"
    return 0
  fi
  
  local source_type
  source_type=$(_yaml_get "$config_file" ".source_type")
  poll_config_get_default_agent "$source_type"
}

# Get the prompt content from a config (handles both template and file)
# Usage: poll_config_get_prompt "/path/to/config.yaml"
poll_config_get_prompt() {
  local config_file="$1"
  
  # Check for inline template first
  local template
  template=$(_yaml_get "$config_file" ".prompt.template")
  
  if [[ -n "$template" ]]; then
    echo "$template"
    return 0
  fi
  
  # Check for file reference
  local prompt_file
  prompt_file=$(_yaml_get "$config_file" ".prompt.file")
  
  if [[ -n "$prompt_file" ]]; then
    local config_dir
    config_dir=$(dirname "$config_file")
    local full_path="$config_dir/$prompt_file"
    
    if [[ -f "$full_path" ]]; then
      cat "$full_path"
      return 0
    else
      echo "Error: Prompt file not found: $full_path" >&2
      return 1
    fi
  fi
  
  echo "Error: No prompt template or file specified" >&2
  return 1
}

# =============================================================================
# Config Listing Functions
# =============================================================================

# List all config files in a directory
# Usage: poll_config_list "/path/to/polls/dir"
poll_config_list() {
  local polls_dir="${1:-$OCDC_POLLS_DIR}"
  
  if [[ ! -d "$polls_dir" ]]; then
    return 0
  fi
  
  find "$polls_dir" -maxdepth 1 \( -name "*.yaml" -o -name "*.yml" \) 2>/dev/null | \
    while read -r file; do
      basename "$file"
    done
}

# List only enabled config files
# Usage: poll_config_list_enabled "/path/to/polls/dir"
poll_config_list_enabled() {
  local polls_dir="${1:-$OCDC_POLLS_DIR}"
  
  if [[ ! -d "$polls_dir" ]]; then
    return 0
  fi
  
  for file in "$polls_dir"/*.yaml "$polls_dir"/*.yml; do
    [[ -f "$file" ]] || continue
    local enabled
    enabled=$(_yaml_get_default "$file" ".enabled" "true")
    # Handle both string "true" and boolean true from YAML
    if [[ "$enabled" == "true" ]]; then
      basename "$file"
    fi
  done
}

# =============================================================================
# Template Rendering
# =============================================================================

# Render a template string with variable substitutions
# Usage: poll_config_render_template "template {var}" var=value var2=value2
poll_config_render_template() {
  local template="$1"
  shift
  
  local result="$template"
  
  # Process each var=value argument
  for arg in "$@"; do
    local var="${arg%%=*}"
    local value="${arg#*=}"
    
    # Replace {var} with value
    result="${result//\{$var\}/$value}"
  done
  
  echo "$result"
}

# =============================================================================
# Exports
# =============================================================================

export OCDC_POLLS_DIR
