#!/usr/bin/env bash
#
# Setup script for ocdc development
#

set -euo pipefail

echo "Installing dependencies..."

# Install jq
sudo apt-get update
sudo apt-get install -y jq

# Install devcontainer CLI
sudo npm install -g @devcontainers/cli

# Add bin to PATH by symlinking
echo "Symlinking scripts to /usr/local/bin..."
for script in bin/*; do
  sudo ln -sf "$(pwd)/$script" /usr/local/bin/
done

echo "Setup complete!"
echo ""
echo "Run tests with: ./test/run_tests.bash"
