# opencode-devcontainers

Run multiple devcontainer instances simultaneously with auto-assigned ports and branch-based isolation.

> **Version 0.x** - Pre-1.0 software. Minor versions may contain breaking changes.

## Why?

When working on multiple branches, you need isolated development environments. Git worktrees don't work with devcontainers because the `.git` file points outside the container.

**opencode-devcontainers** solves this by:
- Creating shallow clones for each branch (fully self-contained)
- Auto-assigning ports from a configurable range (13000-13099)
- Generating ephemeral override configs (your devcontainer.json stays clean)
- Tracking active instances to avoid conflicts

## Installation

```bash
brew install athal7/tap/opencode-devcontainers
```

### Dependencies

- `jq` - JSON processor (auto-installed with Homebrew)
- `devcontainer` CLI - Install with: `npm install -g @devcontainers/cli`

## Usage

### OpenCode Plugin (Recommended)

In OpenCode, use the `/devcontainer` slash command:

```
/devcontainer feature-x    # Target a devcontainer for this session
/devcontainer myapp/main   # Target specific repo/branch
/devcontainer              # Show current status
/devcontainer off          # Disable, run commands on host
```

When a devcontainer is targeted:
- Most commands run inside the container via `ocdc exec`
- Git, file reading, and editors run on host
- Prefix with `HOST:` to force host execution

### CLI Commands

The `ocdc` CLI is primarily used internally by the plugin, but can also be used directly:

```bash
ocdc up                 # Start devcontainer (port 13000)
ocdc up feature-x       # Start for branch (port 13001)
ocdc                    # Interactive TUI
ocdc list               # List instances
ocdc exec bash          # Execute in container
ocdc go feature-x       # Navigate to clone
ocdc down               # Stop current
ocdc down --all         # Stop all
ocdc clean              # Remove orphaned clones
```

### JSON Output

All commands support `--json` for machine-readable output:

```bash
ocdc up feature-x --json --no-open
# {"workspace": "...", "port": 13001, "container_id": "...", "repo": "...", "branch": "feature-x"}

ocdc down --json
# {"success": true, "workspace": "...", "port": 13001, "repo": "..."}

ocdc exec --json -- npm test
# {"stdout": "...", "stderr": "...", "code": 0}

ocdc list --json
# [{"workspace": "...", "port": 13001, "repo": "...", "branch": "...", "status": "up"}]
```

Exit codes: 0=success, 1=error, 2=invalid args, 3=not found.

See [docs/CLI-INTERFACE.md](docs/CLI-INTERFACE.md) for full API documentation.

## Configuration

`~/.config/ocdc/config.json`:
```json
{
  "portRangeStart": 13000,
  "portRangeEnd": 13099
}
```

## How it works

1. **Clones**: `ocdc up feature-x` creates `~/.cache/devcontainer-clones/myapp/feature-x/`. Gitignored secrets are auto-copied.
2. **Ports**: Ephemeral override with unique port, passed via `--override-config`.
3. **Tracking**: `~/.cache/ocdc/ports.json`

## Related

- [opencode-pilot](https://github.com/athal7/opencode-pilot) - Automation layer for OpenCode (notifications, mobile UI, polling)

## License

MIT
