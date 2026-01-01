#!/usr/bin/env bash
#
# Tests for poll configuration schema and validation
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

LIB_DIR="$(dirname "$SCRIPT_DIR")/lib"

echo "Testing poll configuration..."
echo ""

# =============================================================================
# Setup/Teardown
# =============================================================================

setup() {
  setup_test_env
  
  # Create polls directory
  export OCDC_POLLS_DIR="$TEST_CONFIG_DIR/polls"
  mkdir -p "$OCDC_POLLS_DIR"
}

teardown() {
  cleanup_test_env
}

# =============================================================================
# Helper to create test config files
# =============================================================================

create_valid_config() {
  cat > "$OCDC_POLLS_DIR/github-issues.yaml" << 'EOF'
id: github-issues
enabled: true

fetch_command: |
  gh issue list --repo myorg/myrepo --label "ready" --state open --json number,title,body,url

item_mapping:
  key: '"myorg/myrepo-issue-\(.number)"'
  repo: '"myorg/myrepo"'
  repo_short: '"myrepo"'
  number: '.number'
  title: '.title'
  body: '.body'
  url: '.url'
  branch: '"issue-\(.number)"'

repo_paths:
  "myorg/myrepo": "~/Projects/myrepo"

prompt:
  template: |
    Work on issue #{number}: {title}
    {url}

session:
  name_template: "ocdc-{repo_short}-issue-{number}"
EOF
}

create_minimal_config() {
  cat > "$OCDC_POLLS_DIR/minimal.yaml" << 'EOF'
id: minimal
enabled: true

fetch_command: echo '[]'

item_mapping:
  key: '"\(.id)"'

prompt:
  template: "Work on {key}"

session:
  name_template: "ocdc-{key}"
EOF
}

create_config_with_prompt_file() {
  mkdir -p "$OCDC_POLLS_DIR/prompts"
  cat > "$OCDC_POLLS_DIR/prompts/work.md" << 'EOF'
Work on issue #{number}: {title}
{url}
EOF

  cat > "$OCDC_POLLS_DIR/with-prompt-file.yaml" << 'EOF'
id: with-prompt-file
enabled: true

fetch_command: echo '[]'

item_mapping:
  key: '"\(.id)"'

prompt:
  file: prompts/work.md

session:
  name_template: "ocdc-{key}"
EOF
}

create_disabled_config() {
  cat > "$OCDC_POLLS_DIR/disabled.yaml" << 'EOF'
id: disabled-poll
enabled: false

fetch_command: echo '[]'

item_mapping:
  key: '"\(.id)"'

prompt:
  template: "Work"

session:
  name_template: "ocdc-{key}"
EOF
}

create_invalid_config_missing_id() {
  cat > "$OCDC_POLLS_DIR/invalid-missing-id.yaml" << 'EOF'
enabled: true

fetch_command: echo '[]'

item_mapping:
  key: '"\(.id)"'

prompt:
  template: "Work"

session:
  name_template: "ocdc-{key}"
EOF
}

create_invalid_config_missing_fetch() {
  cat > "$OCDC_POLLS_DIR/invalid-missing-fetch.yaml" << 'EOF'
id: missing-fetch
enabled: true

item_mapping:
  key: '"\(.id)"'

prompt:
  template: "Work"

session:
  name_template: "ocdc-{key}"
EOF
}

create_invalid_config_missing_prompt() {
  cat > "$OCDC_POLLS_DIR/invalid-missing-prompt.yaml" << 'EOF'
id: missing-prompt
enabled: true

fetch_command: echo '[]'

item_mapping:
  key: '"\(.id)"'

session:
  name_template: "ocdc-{key}"
EOF
}

create_invalid_config_missing_session() {
  cat > "$OCDC_POLLS_DIR/invalid-missing-session.yaml" << 'EOF'
id: missing-session
enabled: true

fetch_command: echo '[]'

item_mapping:
  key: '"\(.id)"'

prompt:
  template: "Work"
EOF
}

create_invalid_config_missing_key_mapping() {
  cat > "$OCDC_POLLS_DIR/invalid-missing-key.yaml" << 'EOF'
id: missing-key
enabled: true

fetch_command: echo '[]'

item_mapping:
  number: '.number'

prompt:
  template: "Work"

session:
  name_template: "ocdc-{key}"
EOF
}

# =============================================================================
# Tests
# =============================================================================

test_poll_config_library_exists() {
  if [[ ! -f "$LIB_DIR/ocdc-poll-config.bash" ]]; then
    echo "lib/ocdc-poll-config.bash does not exist"
    return 1
  fi
  return 0
}

test_poll_config_can_be_sourced() {
  if ! source "$LIB_DIR/ocdc-poll-config.bash" 2>&1; then
    echo "Failed to source ocdc-poll-config.bash"
    return 1
  fi
  return 0
}

test_validate_valid_config() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_valid_config
  
  if ! poll_config_validate "$OCDC_POLLS_DIR/github-issues.yaml"; then
    echo "Valid config should pass validation"
    return 1
  fi
  return 0
}

test_validate_minimal_config() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_minimal_config
  
  if ! poll_config_validate "$OCDC_POLLS_DIR/minimal.yaml"; then
    echo "Minimal valid config should pass validation"
    return 1
  fi
  return 0
}

test_validate_config_with_prompt_file() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_config_with_prompt_file
  
  if ! poll_config_validate "$OCDC_POLLS_DIR/with-prompt-file.yaml"; then
    echo "Config with prompt file should pass validation"
    return 1
  fi
  return 0
}

test_validate_rejects_missing_id() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_invalid_config_missing_id
  
  if poll_config_validate "$OCDC_POLLS_DIR/invalid-missing-id.yaml" 2>/dev/null; then
    echo "Config missing 'id' should fail validation"
    return 1
  fi
  return 0
}

test_validate_rejects_missing_fetch() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_invalid_config_missing_fetch
  
  if poll_config_validate "$OCDC_POLLS_DIR/invalid-missing-fetch.yaml" 2>/dev/null; then
    echo "Config missing 'fetch_command' should fail validation"
    return 1
  fi
  return 0
}

test_validate_rejects_missing_prompt() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_invalid_config_missing_prompt
  
  if poll_config_validate "$OCDC_POLLS_DIR/invalid-missing-prompt.yaml" 2>/dev/null; then
    echo "Config missing 'prompt' should fail validation"
    return 1
  fi
  return 0
}

test_validate_rejects_missing_session() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_invalid_config_missing_session
  
  if poll_config_validate "$OCDC_POLLS_DIR/invalid-missing-session.yaml" 2>/dev/null; then
    echo "Config missing 'session' should fail validation"
    return 1
  fi
  return 0
}

test_validate_rejects_missing_key_mapping() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_invalid_config_missing_key_mapping
  
  if poll_config_validate "$OCDC_POLLS_DIR/invalid-missing-key.yaml" 2>/dev/null; then
    echo "Config missing 'item_mapping.key' should fail validation"
    return 1
  fi
  return 0
}

test_get_config_field() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_valid_config
  
  local id
  id=$(poll_config_get "$OCDC_POLLS_DIR/github-issues.yaml" ".id")
  assert_equals "github-issues" "$id"
}

test_get_config_nested_field() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_valid_config
  
  local session_name
  session_name=$(poll_config_get "$OCDC_POLLS_DIR/github-issues.yaml" ".session.name_template")
  assert_equals 'ocdc-{repo_short}-issue-{number}' "$session_name"
}

test_get_config_enabled_defaults_to_true() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_minimal_config
  
  local enabled
  enabled=$(poll_config_get_with_default "$OCDC_POLLS_DIR/minimal.yaml" ".enabled" "true")
  assert_equals "true" "$enabled"
}

test_list_all_configs() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_valid_config
  create_disabled_config
  
  local configs
  configs=$(poll_config_list "$OCDC_POLLS_DIR")
  
  # Should find both configs
  if [[ "$configs" != *"github-issues.yaml"* ]]; then
    echo "Should list github-issues.yaml"
    return 1
  fi
  if [[ "$configs" != *"disabled.yaml"* ]]; then
    echo "Should list disabled.yaml"
    return 1
  fi
  return 0
}

test_list_enabled_configs_only() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_valid_config      # enabled: true
  create_disabled_config   # enabled: false
  
  local configs
  configs=$(poll_config_list_enabled "$OCDC_POLLS_DIR")
  
  # Should only find enabled config
  if [[ "$configs" != *"github-issues.yaml"* ]]; then
    echo "Should list enabled github-issues.yaml"
    return 1
  fi
  if [[ "$configs" == *"disabled.yaml"* ]]; then
    echo "Should not list disabled disabled.yaml"
    return 1
  fi
  return 0
}

test_render_template_simple() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  
  local template="Issue #{number}: {title}"
  local result
  result=$(poll_config_render_template "$template" number=123 title="Add feature")
  
  assert_equals "Issue #123: Add feature" "$result"
}

test_render_template_multiple_vars() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  
  local template="Working on {repo} branch {branch}"
  local result
  result=$(poll_config_render_template "$template" \
    repo="myorg/api" \
    branch="issue-42")
  
  assert_equals "Working on myorg/api branch issue-42" "$result"
}

test_render_template_preserves_unknown_vars() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  
  local template="Known: {known}, Unknown: {unknown}"
  local result
  result=$(poll_config_render_template "$template" known="value")
  
  assert_equals "Known: value, Unknown: {unknown}" "$result"
}

test_load_prompt_from_template() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_valid_config
  
  local prompt
  prompt=$(poll_config_get_prompt "$OCDC_POLLS_DIR/github-issues.yaml")
  
  if [[ "$prompt" != *"Work on issue"* ]]; then
    echo "Should load prompt template"
    return 1
  fi
  return 0
}

test_load_prompt_from_file() {
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_config_with_prompt_file
  
  local prompt
  prompt=$(poll_config_get_prompt "$OCDC_POLLS_DIR/with-prompt-file.yaml")
  
  if [[ "$prompt" != *"Work on issue"* ]]; then
    echo "Should load prompt from file"
    return 1
  fi
  return 0
}

# =============================================================================
# Schema Validation Tests (requires check-jsonschema)
# =============================================================================

test_validate_against_schema_valid() {
  # Skip if check-jsonschema not available
  if ! command -v check-jsonschema >/dev/null 2>&1; then
    return 0
  fi
  
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_valid_config
  
  local schema_file
  schema_file="$(dirname "$LIB_DIR")/share/ocdc/poll-config.schema.json"
  
  if [[ ! -f "$schema_file" ]]; then
    echo "Schema file not found: $schema_file"
    return 1
  fi
  
  if ! poll_config_validate_schema "$OCDC_POLLS_DIR/github-issues.yaml" "$schema_file"; then
    echo "Valid config should pass schema validation"
    return 1
  fi
  return 0
}

test_validate_against_schema_invalid() {
  # Skip if check-jsonschema not available
  if ! command -v check-jsonschema >/dev/null 2>&1; then
    return 0
  fi
  
  source "$LIB_DIR/ocdc-poll-config.bash"
  create_invalid_config_missing_id
  
  local schema_file
  schema_file="$(dirname "$LIB_DIR")/share/ocdc/poll-config.schema.json"
  
  if poll_config_validate_schema "$OCDC_POLLS_DIR/invalid-missing-id.yaml" "$schema_file" 2>/dev/null; then
    echo "Invalid config should fail schema validation"
    return 1
  fi
  return 0
}

# =============================================================================
# Run Tests
# =============================================================================

echo "Poll Configuration Tests:"

for test_func in \
  test_poll_config_library_exists \
  test_poll_config_can_be_sourced \
  test_validate_valid_config \
  test_validate_minimal_config \
  test_validate_config_with_prompt_file \
  test_validate_rejects_missing_id \
  test_validate_rejects_missing_fetch \
  test_validate_rejects_missing_prompt \
  test_validate_rejects_missing_session \
  test_validate_rejects_missing_key_mapping \
  test_get_config_field \
  test_get_config_nested_field \
  test_get_config_enabled_defaults_to_true \
  test_list_all_configs \
  test_list_enabled_configs_only \
  test_render_template_simple \
  test_render_template_multiple_vars \
  test_render_template_preserves_unknown_vars \
  test_load_prompt_from_template \
  test_load_prompt_from_file \
  test_validate_against_schema_valid \
  test_validate_against_schema_invalid
do
  setup
  run_test "${test_func#test_}" "$test_func"
  teardown
done

print_summary
