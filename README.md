# opencode-devcontainers

OpenCode plugin for isolated branch workspaces using devcontainers or git worktrees.

> **Note**: This is a community project and is not built by or affiliated with the OpenCode team.

> **Version 0.x** - Pre-1.0 software. Minor versions may contain breaking changes.

## Why?

When working on multiple branches, you need isolated development environments:

- **Devcontainers** provide full container isolation (different dependencies, databases, etc.)
- **Worktrees** provide lightweight filesystem isolation (same dependencies, just different code)

This plugin provides both options with:
- Session state management (the agent remembers your workspace)
- Auto-assigned ports from a configurable range (13000-13099)
- Automatic copying of gitignored secrets (.env, credentials, etc.)
- Unified workspace management and cleanup

## Installation

Add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-devcontainers"]
}
```

OpenCode automatically installs npm plugins on startup.

### Dependencies

- For devcontainers: `devcontainer` CLI - Install with: `npm install -g @devcontainers/cli`
- For worktrees: Just git (no additional dependencies)

## Usage

### Devcontainers (Full Container Isolation)

```
/devcontainer feature-x    # Start/target a devcontainer for this branch
/devcontainer myapp/main   # Target specific repo/branch
/devcontainer              # Show current status
/devcontainer off          # Disable, run commands on host
```

When a devcontainer is targeted:
- Most commands run inside the container automatically
- Git operations and file reading run on host
- Prefix with `HOST:` to force host execution

### Worktrees (Lightweight Filesystem Isolation)

```
/worktree feature-x        # Create/target a worktree for this branch
/worktree myapp/main       # Target specific repo/branch
/worktree                  # Show current status
/worktree off              # Disable, run commands in original directory
```

When a worktree is targeted:
- Bash commands run in the worktree directory
- Same `HOST:` prefix for escaping
- Gitignored files are automatically copied from main repo

### Workspace Management

```
/workspaces                # List all workspaces (clones + worktrees)
/workspaces cleanup        # Find stale workspaces (not used in 7+ days)
```

## When to Use What

| Use Case | Recommendation |
|----------|----------------|
| Project has devcontainer.json | `/devcontainer` |
| Different dependencies per branch | `/devcontainer` |
| Quick branch work, same deps | `/worktree` |
| No Docker or Podman available | `/worktree` |
| Testing migrations/databases | `/devcontainer` |

## Configuration

`~/.config/opencode/devcontainers/config.json`:
```json
{
  "portRangeStart": 13000,
  "portRangeEnd": 13099,
  "dockerPath": "podman",
  "dockerComposePath": "podman-compose"
}
```

`dockerPath` and `dockerComposePath` are optional. When unset, the plugin uses Docker when available, otherwise Podman. A Podman runtime requires either `podman-compose` or `docker-compose`; the plugin detects one automatically and reports an unsupported configuration when neither is available. Set both paths explicitly to use nonstandard executable locations.

## How It Works

### Devcontainers
1. Creates clone in `~/.local/share/opencode/clone/<repo>/<branch>/`
2. Copies gitignored secrets from main repo
3. Generates ephemeral override config with unique port
4. Starts container via `devcontainer up`

### Worktrees
1. Creates worktree in `~/.local/share/opencode/worktree/<repo>/<branch>/`
2. Copies gitignored secrets from main repo
3. Runs `direnv allow` if .envrc exists
4. Sets bash workdir to the worktree path

### Port/Database Isolation (Worktrees)

For worktrees, you can configure your `.envrc` to derive PORT and database settings from the worktree name to avoid conflicts:

```bash
# .envrc
export BRANCH_NAME=$(basename $(pwd))
export PORT=$((3000 + $(echo "$BRANCH_NAME" | cksum | cut -d' ' -f1) % 1000))
export DATABASE_URL="postgres://localhost/${BRANCH_NAME//-/_}_development"
```

## Integration with opencode-pilot

When using [opencode-pilot](https://github.com/athal7/opencode-pilot) for automated issue processing, configure your `repos.yaml`:

```yaml
repos:
  myorg/myrepo:
    session:
      prompt_template: |
        /devcontainer issue-{number}

        {title}

        {body}
```

This starts an isolated devcontainer for each issue automatically.

## Known Issues

### OpenCode Desktop shows changes from wrong directory

When switching workspaces with `/devcontainer` or `/worktree`, OpenCode's internal directory context doesn't update. The "Session changes" panel continues showing diffs from the original directory.

**Workaround**: Start OpenCode directly in the target directory, or use separate terminal sessions per workspace.

**Upstream issue**: [anomalyco/opencode#6697](https://github.com/anomalyco/opencode/issues/6697)

## Environment Variables

Override default paths:
- `OCDC_CONFIG_DIR` - Config directory (default: `~/.config/opencode/devcontainers`)
- `OCDC_CACHE_DIR` - Cache directory (default: `~/.cache/opencode-devcontainers`)
- `OCDC_CLONES_DIR` - Clones directory (default: `~/.local/share/opencode/clone`)
- `OCDC_WORKTREES_DIR` - Worktrees directory (default: `~/.local/share/opencode/worktree`)
- `OCDC_SESSIONS_DIR` - Sessions directory (default: `<cache>/opencode-sessions`)

## Related

- [opencode-pilot](https://github.com/athal7/opencode-pilot) - Automation layer for OpenCode (notifications, mobile UI, polling)

## License

MIT
