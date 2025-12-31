#!/usr/bin/env bash
#
# Install devcontainer-multi scripts
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/athal7/devcontainer-multi/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/athal7/devcontainer-multi/main/install.sh | bash -s -- ~/.local/bin
#

set -euo pipefail

INSTALL_DIR="${1:-$HOME/.local/bin}"
REPO="athal7/devcontainer-multi"
SCRIPTS="dcup dcdown dclist dcexec dcgo dctui"

echo "Installing devcontainer-multi to $INSTALL_DIR"

# Create install directory if needed
mkdir -p "$INSTALL_DIR"

# Check if we're running from a local clone or need to download
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}" 2>/dev/null)" && pwd 2>/dev/null)" || SCRIPT_DIR=""

if [[ -n "$SCRIPT_DIR" ]] && [[ -f "$SCRIPT_DIR/bin/dcup" ]]; then
  # Local install from clone
  echo "Installing from local directory..."
  for script in $SCRIPTS; do
    if [[ -f "$SCRIPT_DIR/bin/$script" ]]; then
      cp "$SCRIPT_DIR/bin/$script" "$INSTALL_DIR/$script"
      chmod +x "$INSTALL_DIR/$script"
      echo "  Installed: $script"
    fi
  done
else
  # Remote install - download from GitHub
  echo "Downloading from GitHub..."
  
  # Try to get latest release, fall back to main branch
  DOWNLOAD_URL="https://raw.githubusercontent.com/$REPO/main/bin"
  
  for script in $SCRIPTS; do
    echo "  Downloading: $script"
    if curl -fsSL "$DOWNLOAD_URL/$script" -o "$INSTALL_DIR/$script"; then
      chmod +x "$INSTALL_DIR/$script"
      echo "  Installed: $script"
    else
      echo "  ERROR: Failed to download $script"
      exit 1
    fi
  done
fi

# Check if install dir is in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo ""
  echo "Note: $INSTALL_DIR is not in your PATH."
  echo "Add this to your shell profile:"
  echo ""
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi

# Check dependencies
echo ""
echo "Checking dependencies..."

missing_deps=false
if ! command -v jq >/dev/null 2>&1; then
  echo "  WARNING: jq not found. Install with: brew install jq"
  missing_deps=true
fi

if ! command -v devcontainer >/dev/null 2>&1; then
  echo "  WARNING: devcontainer CLI not found. Install with: npm install -g @devcontainers/cli"
  missing_deps=true
fi

if [[ "$missing_deps" == "false" ]]; then
  echo "  All dependencies found!"
fi

echo ""
echo "Installation complete!"
echo ""
echo "Commands:"
echo "  dcup [branch]   - Start devcontainer"
echo "  dcdown          - Stop devcontainer"
echo "  dclist          - List instances"
echo "  dcgo [branch]   - Navigate to clone"
echo "  dcexec <cmd>    - Execute in container"
echo "  dctui           - Interactive TUI"
