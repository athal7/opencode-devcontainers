#!/usr/bin/env bash
#
# ocdc-file-lock.bash - Cross-platform file locking using mkdir
#
# Uses mkdir-based locking which is atomic and portable across
# macOS and Linux (flock is not available on macOS by default).
#

# Acquire a lock using mkdir (atomic operation)
# Spins until lock is acquired
lock_file() {
  local lockdir="$1"
  while ! mkdir "$lockdir" 2>/dev/null; do
    sleep 0.1
  done
}

# Release a lock by removing the directory
# Succeeds even if lock doesn't exist
unlock_file() {
  local lockdir="$1"
  rmdir "$lockdir" 2>/dev/null || true
}
