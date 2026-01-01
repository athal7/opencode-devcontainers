#!/usr/bin/env bash
#
# Tests for poll configuration schema validation
#
# These tests validate that:
# 1. The JSON schema is valid
# 2. Example configs conform to the schema
# 3. Invalid configs are rejected by the schema
#
# Requires: check-jsonschema (pip install check-jsonschema)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test_helper.bash"

REPO_DIR="$(dirname "$SCRIPT_DIR")"
SCHEMA_FILE="$REPO_DIR/share/ocdc/poll-config.schema.json"
EXAMPLES_DIR="$REPO_DIR/share/ocdc/examples"

echo "Testing poll configuration schema..."
echo ""

# =============================================================================
# Setup/Teardown
# =============================================================================

setup() {
  setup_test_env
  
  # Check if check-jsonschema is available
  if ! command -v check-jsonschema >/dev/null 2>&1; then
    echo "Warning: check-jsonschema not installed. Install with: pip install check-jsonschema"
    return 1
  fi
}

teardown() {
  cleanup_test_env
}

# =============================================================================
# Tests
# =============================================================================

test_schema_file_exists() {
  if [[ ! -f "$SCHEMA_FILE" ]]; then
    echo "Schema file does not exist: $SCHEMA_FILE"
    return 1
  fi
  return 0
}

test_schema_is_valid_json() {
  if ! jq empty "$SCHEMA_FILE" 2>/dev/null; then
    echo "Schema file is not valid JSON"
    return 1
  fi
  return 0
}

test_github_issues_example_validates() {
  local example="$EXAMPLES_DIR/github-issues.yaml"
  if [[ ! -f "$example" ]]; then
    echo "Example file does not exist: $example"
    return 1
  fi
  
  if ! check-jsonschema --schemafile "$SCHEMA_FILE" "$example" 2>&1; then
    echo "github-issues.yaml should validate against schema"
    return 1
  fi
  return 0
}

test_github_pr_reviews_example_validates() {
  local example="$EXAMPLES_DIR/github-pr-reviews.yaml"
  if [[ ! -f "$example" ]]; then
    echo "Example file does not exist: $example"
    return 1
  fi
  
  if ! check-jsonschema --schemafile "$SCHEMA_FILE" "$example" 2>&1; then
    echo "github-pr-reviews.yaml should validate against schema"
    return 1
  fi
  return 0
}

test_schema_rejects_missing_id() {
  local invalid_config="$TEST_DIR/invalid-missing-id.yaml"
  cat > "$invalid_config" << 'EOF'
enabled: true
fetch_command: echo '[]'
item_mapping:
  key: '"\(.id)"'
prompt:
  template: "Work"
session:
  name_template: "ocdc-{key}"
EOF

  if check-jsonschema --schemafile "$SCHEMA_FILE" "$invalid_config" 2>/dev/null; then
    echo "Config missing 'id' should fail schema validation"
    return 1
  fi
  return 0
}

test_schema_rejects_missing_fetch_command() {
  local invalid_config="$TEST_DIR/invalid-missing-fetch.yaml"
  cat > "$invalid_config" << 'EOF'
id: test
enabled: true
item_mapping:
  key: '"\(.id)"'
prompt:
  template: "Work"
session:
  name_template: "ocdc-{key}"
EOF

  if check-jsonschema --schemafile "$SCHEMA_FILE" "$invalid_config" 2>/dev/null; then
    echo "Config missing 'fetch_command' should fail schema validation"
    return 1
  fi
  return 0
}

test_schema_rejects_missing_item_mapping() {
  local invalid_config="$TEST_DIR/invalid-missing-mapping.yaml"
  cat > "$invalid_config" << 'EOF'
id: test
enabled: true
fetch_command: echo '[]'
prompt:
  template: "Work"
session:
  name_template: "ocdc-{key}"
EOF

  if check-jsonschema --schemafile "$SCHEMA_FILE" "$invalid_config" 2>/dev/null; then
    echo "Config missing 'item_mapping' should fail schema validation"
    return 1
  fi
  return 0
}

test_schema_rejects_missing_prompt() {
  local invalid_config="$TEST_DIR/invalid-missing-prompt.yaml"
  cat > "$invalid_config" << 'EOF'
id: test
enabled: true
fetch_command: echo '[]'
item_mapping:
  key: '"\(.id)"'
session:
  name_template: "ocdc-{key}"
EOF

  if check-jsonschema --schemafile "$SCHEMA_FILE" "$invalid_config" 2>/dev/null; then
    echo "Config missing 'prompt' should fail schema validation"
    return 1
  fi
  return 0
}

test_schema_rejects_missing_session() {
  local invalid_config="$TEST_DIR/invalid-missing-session.yaml"
  cat > "$invalid_config" << 'EOF'
id: test
enabled: true
fetch_command: echo '[]'
item_mapping:
  key: '"\(.id)"'
prompt:
  template: "Work"
EOF

  if check-jsonschema --schemafile "$SCHEMA_FILE" "$invalid_config" 2>/dev/null; then
    echo "Config missing 'session' should fail schema validation"
    return 1
  fi
  return 0
}

test_schema_rejects_missing_item_mapping_key() {
  local invalid_config="$TEST_DIR/invalid-missing-key.yaml"
  cat > "$invalid_config" << 'EOF'
id: test
enabled: true
fetch_command: echo '[]'
item_mapping:
  number: '.number'
prompt:
  template: "Work"
session:
  name_template: "ocdc-{key}"
EOF

  if check-jsonschema --schemafile "$SCHEMA_FILE" "$invalid_config" 2>/dev/null; then
    echo "Config missing 'item_mapping.key' should fail schema validation"
    return 1
  fi
  return 0
}

test_schema_rejects_missing_session_name_template() {
  local invalid_config="$TEST_DIR/invalid-missing-name.yaml"
  cat > "$invalid_config" << 'EOF'
id: test
enabled: true
fetch_command: echo '[]'
item_mapping:
  key: '"\(.id)"'
prompt:
  template: "Work"
session:
  agent: plan
EOF

  if check-jsonschema --schemafile "$SCHEMA_FILE" "$invalid_config" 2>/dev/null; then
    echo "Config missing 'session.name_template' should fail schema validation"
    return 1
  fi
  return 0
}

test_schema_accepts_minimal_valid_config() {
  local valid_config="$TEST_DIR/minimal-valid.yaml"
  cat > "$valid_config" << 'EOF'
id: minimal
fetch_command: echo '[]'
item_mapping:
  key: '"\(.id)"'
prompt:
  template: "Work"
session:
  name_template: "ocdc-{key}"
EOF

  if ! check-jsonschema --schemafile "$SCHEMA_FILE" "$valid_config" 2>&1; then
    echo "Minimal valid config should pass schema validation"
    return 1
  fi
  return 0
}

test_schema_accepts_config_with_agent() {
  local valid_config="$TEST_DIR/with-agent.yaml"
  cat > "$valid_config" << 'EOF'
id: with-agent
fetch_command: echo '[]'
item_mapping:
  key: '"\(.id)"'
prompt:
  template: "Work"
session:
  name_template: "ocdc-{key}"
  agent: build
EOF

  if ! check-jsonschema --schemafile "$SCHEMA_FILE" "$valid_config" 2>&1; then
    echo "Config with agent should pass schema validation"
    return 1
  fi
  return 0
}

test_schema_accepts_config_with_prompt_file() {
  local valid_config="$TEST_DIR/with-prompt-file.yaml"
  cat > "$valid_config" << 'EOF'
id: with-prompt-file
fetch_command: echo '[]'
item_mapping:
  key: '"\(.id)"'
prompt:
  file: prompts/work.md
session:
  name_template: "ocdc-{key}"
EOF

  if ! check-jsonschema --schemafile "$SCHEMA_FILE" "$valid_config" 2>&1; then
    echo "Config with prompt file should pass schema validation"
    return 1
  fi
  return 0
}

# =============================================================================
# Run Tests
# =============================================================================

# Check for required tool first
if ! command -v check-jsonschema >/dev/null 2>&1; then
  echo -e "${YELLOW}SKIPPED${NC}: check-jsonschema not installed"
  echo "Install with: pip install check-jsonschema"
  exit 0
fi

echo "Schema Validation Tests:"

for test_func in \
  test_schema_file_exists \
  test_schema_is_valid_json \
  test_github_issues_example_validates \
  test_github_pr_reviews_example_validates \
  test_schema_rejects_missing_id \
  test_schema_rejects_missing_fetch_command \
  test_schema_rejects_missing_item_mapping \
  test_schema_rejects_missing_prompt \
  test_schema_rejects_missing_session \
  test_schema_rejects_missing_item_mapping_key \
  test_schema_rejects_missing_session_name_template \
  test_schema_accepts_minimal_valid_config \
  test_schema_accepts_config_with_agent \
  test_schema_accepts_config_with_prompt_file
do
  setup
  run_test "${test_func#test_}" "$test_func"
  teardown
done

print_summary
