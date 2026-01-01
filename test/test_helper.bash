#!/usr/bin/env bash
#
# Test helper functions for devcontainer-multi tests
#

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Setup test environment
setup_test_env() {
  export TEST_DIR=$(mktemp -d)
  export TEST_CONFIG_DIR="$TEST_DIR/config"
  export TEST_CACHE_DIR="$TEST_DIR/cache"
  export TEST_CLONES_DIR="$TEST_DIR/clones"
  export TEST_DATA_DIR="$TEST_DIR/data"
  
  mkdir -p "$TEST_CONFIG_DIR" "$TEST_CACHE_DIR" "$TEST_CLONES_DIR" "$TEST_DATA_DIR"
  
  # Set env vars for scripts (new OCDC vars)
  export OCDC_CONFIG_DIR="$TEST_CONFIG_DIR"
  export OCDC_CACHE_DIR="$TEST_CACHE_DIR"
  export OCDC_CLONES_DIR="$TEST_CLONES_DIR"
  export OCDC_DATA_DIR="$TEST_DATA_DIR"
  
  # Legacy env vars (for backward compatibility during transition)
  export DCMULTI_CONFIG_DIR="$TEST_CONFIG_DIR"
  export DCMULTI_CACHE_DIR="$TEST_CACHE_DIR"
  export DCMULTI_CLONES_DIR="$TEST_CLONES_DIR"
  
  # Initialize empty ports file
  echo '{}' > "$TEST_CACHE_DIR/ports.json"
  echo '{}' > "$TEST_CONFIG_DIR/config.json"
}

# Cleanup test environment
cleanup_test_env() {
  if [[ -n "$TEST_DIR" ]] && [[ -d "$TEST_DIR" ]]; then
    rm -rf "$TEST_DIR"
  fi
}

# Assert equality
assert_equals() {
  local expected="$1"
  local actual="$2"
  local message="${3:-Values should be equal}"
  
  if [[ "$expected" == "$actual" ]]; then
    return 0
  else
    echo "  Expected: $expected"
    echo "  Actual:   $actual"
    return 1
  fi
}

# Assert string contains
assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="${3:-String should contain substring}"
  
  if [[ "$haystack" == *"$needle"* ]]; then
    return 0
  else
    echo "  String: $haystack"
    echo "  Should contain: $needle"
    return 1
  fi
}

# Assert command succeeds
assert_success() {
  local cmd="$1"
  local message="${2:-Command should succeed}"
  
  if eval "$cmd" >/dev/null 2>&1; then
    return 0
  else
    echo "  Command failed: $cmd"
    return 1
  fi
}

# Assert command fails
assert_failure() {
  local cmd="$1"
  local message="${2:-Command should fail}"
  
  if eval "$cmd" >/dev/null 2>&1; then
    echo "  Command should have failed: $cmd"
    return 1
  else
    return 0
  fi
}

# Assert file exists
assert_file_exists() {
  local file="$1"
  local message="${2:-File should exist}"
  
  if [[ -f "$file" ]]; then
    return 0
  else
    echo "  File does not exist: $file"
    return 1
  fi
}

# Assert JSON equals
assert_json_equals() {
  local expected="$1"
  local actual="$2"
  local message="${3:-JSON values should be equal}"
  
  # Normalize JSON for comparison
  local norm_expected=$(echo "$expected" | jq -S '.' 2>/dev/null)
  local norm_actual=$(echo "$actual" | jq -S '.' 2>/dev/null)
  
  if [[ "$norm_expected" == "$norm_actual" ]]; then
    return 0
  else
    echo "  Expected: $norm_expected"
    echo "  Actual:   $norm_actual"
    return 1
  fi
}

# Run a single test
run_test() {
  local test_name="$1"
  local test_func="$2"
  
  TESTS_RUN=$((TESTS_RUN + 1))
  
  printf "  %-50s " "$test_name"
  
  # Run test in subshell to isolate failures
  local output
  if output=$($test_func 2>&1); then
    echo -e "${GREEN}PASS${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}FAIL${NC}"
    if [[ -n "$output" ]]; then
      echo "$output" | sed 's/^/    /'
    fi
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# Print test summary
print_summary() {
  echo ""
  echo "========================================"
  echo "Tests run:    $TESTS_RUN"
  echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
  if [[ $TESTS_FAILED -gt 0 ]]; then
    echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
  else
    echo "Tests failed: $TESTS_FAILED"
  fi
  echo "========================================"
  
  if [[ $TESTS_FAILED -gt 0 ]]; then
    return 1
  fi
  return 0
}
