#!/usr/bin/env bash
#
# ocdc-yaml.bash - YAML parsing utilities
#
# Provides functions for converting YAML to JSON and extracting values.
# Uses Ruby's built-in YAML support for parsing.
#
# Usage:
#   source "$(dirname "$0")/ocdc-yaml.bash"
#   value=$(_yaml_get "/path/to/file.yaml" ".field.subfield")
#
# Required: ruby, jq

# Prevent multiple sourcing
[[ -n "${_OCDC_YAML_LOADED:-}" ]] && return 0
_OCDC_YAML_LOADED=1

# =============================================================================
# YAML to JSON conversion
# =============================================================================

# Convert YAML file to JSON using Ruby's built-in YAML support
# Outputs directly to stdout - pipe to jq for processing
# Usage: _yaml_to_json "/path/to/file.yaml"
_yaml_to_json() {
  local yaml_file="$1"
  
  if [[ ! -f "$yaml_file" ]]; then
    echo "Error: File not found: $yaml_file" >&2
    return 1
  fi
  
  # Pass filename as argument to avoid shell injection
  ruby -ryaml -rjson -e 'puts JSON.generate(YAML.load_file(ARGV[0]))' "$yaml_file" 2>/dev/null
}

# Get a field from YAML file using jq path
# Pipes directly from ruby to jq to avoid bash variable issues with multiline strings
# Usage: _yaml_get "/path/to/file.yaml" ".field.subfield"
_yaml_get() {
  local yaml_file="$1"
  local jq_path="$2"
  
  if [[ ! -f "$yaml_file" ]]; then
    echo "Error: File not found: $yaml_file" >&2
    return 1
  fi
  
  # Pass filename as argument to avoid shell injection
  ruby -ryaml -rjson -e 'puts JSON.generate(YAML.load_file(ARGV[0]))' "$yaml_file" 2>/dev/null | \
    jq -r "$jq_path | if . == null then empty else . end" 2>/dev/null
}

# Get a field from YAML with a default value
# Usage: _yaml_get_default "/path/to/file.yaml" ".field" "default"
_yaml_get_default() {
  local yaml_file="$1"
  local jq_path="$2"
  local default="$3"
  
  local value
  value=$(_yaml_get "$yaml_file" "$jq_path")
  
  if [[ -z "$value" ]] || [[ "$value" == "null" ]]; then
    echo "$default"
  else
    echo "$value"
  fi
}
