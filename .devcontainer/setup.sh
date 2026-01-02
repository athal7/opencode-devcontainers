#!/usr/bin/env bash
#
# Setup script for ocdc development
#

set -euo pipefail

echo "Installing dependencies..."

# Source NVM environment (installed by devcontainer node feature)
# This is needed because postCreateCommand runs via /bin/sh -c which doesn't
# load the interactive shell profile where NVM is typically sourced
export NVM_DIR="/usr/local/share/nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Install jq
sudo apt-get update
sudo apt-get install -y jq

# Install devcontainer CLI
# Preserve PATH since sudo resets it and doesn't include NVM's node directory
sudo env "PATH=$PATH" npm install -g @devcontainers/cli

# Add bin to PATH by symlinking
echo "Symlinking scripts to /usr/local/bin..."
for script in bin/*; do
  sudo ln -sf "$(pwd)/$script" /usr/local/bin/
done

echo "Setup complete!"
echo ""
echo "Run tests with: ./test/run_tests.bash"
