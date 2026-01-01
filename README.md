```
      ⚡
  ___  ___ ___  ___ 
 / _ \/ __/ _ \/ __|
| (_) | (_| (_) | (__ 
 \___/ \___\___/ \___|
      ⚡
   OpenCode DevContainers
```

Run multiple devcontainer instances simultaneously with auto-assigned ports and branch management.

## Why?

When working on multiple branches, you need isolated development environments. Git worktrees don't work with devcontainers because the `.git` file points outside the container.

**ocdc** solves this by:
- Creating shallow clones for each branch (fully self-contained)
- Auto-assigning ports from a configurable range (13000-13099)
- Generating ephemeral override configs (your devcontainer.json stays clean)
- Tracking active instances to avoid conflicts

## Installation

```bash
brew install athal7/tap/ocdc
```

Requires: `jq`, `devcontainer` CLI (`npm install -g @devcontainers/cli`)

## Usage

```bash
ocdc up                 # Start devcontainer (port 13000)
ocdc up feature-x       # Start for branch (port 13001)
ocdc                    # Interactive TUI
ocdc list               # List instances
ocdc exec bash          # Execute in container
ocdc go feature-x       # Navigate to clone
ocdc down               # Stop current
ocdc down --all         # Stop all
```

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

## Poll Configuration

ocdc can automatically poll external sources (GitHub PRs, Linear issues) and create devcontainer sessions with OpenCode to work on them.

### Config Location

```
~/.config/ocdc/polls/
├── github-reviews.yaml    # Your poll configs
├── linear-assigned.yaml
└── prompts/               # External prompt templates (optional)
    └── custom-review.md
```

### Schema Reference

```yaml
# Required fields
id: github-reviews              # Unique poll identifier
source: github-search           # Source adapter: github-search | linear
enabled: true                   # Enable/disable this poll

# Source-specific configuration
config:
  query: "is:pr is:open review-requested:@me"  # For github-search
  # OR for linear:
  # filter:
  #   assignee: "@me"
  #   state:
  #     type:
  #       in: [started, unstarted]

# Filtering (optional)
filters:
  repos:
    allow: ["myorg/*"]          # Glob patterns to include
    deny: ["myorg/archived-*"]  # Glob patterns to exclude
  labels:
    deny: ["wip", "draft"]      # Skip items with these labels

# Template strings for naming
key_template: "{repo}-pr-{number}"      # Unique key for this item
clone_name_template: "pr-{number}"      # Directory name for clone
branch_template: "{head_ref}"           # Git branch to checkout

# Repository source (for Linear - maps issues to repos)
repo_source:
  strategy: auto                # auto | map | fixed
  mapping:                      # For strategy: map
    "team:ENG": "~/Projects/api"
    "label:frontend": "~/Projects/web"
  default: "~/Projects/main"    # Fallback if no match

# Prompt configuration
prompt:
  template: |                   # Inline template
    Working on PR #{number}: {title}
    URL: {source_url}
  # OR use external file:
  # file: prompts/custom-review.md

# Session configuration
session:
  name_template: "ocdc-{key}"   # tmux session name
  agent: review                 # OpenCode agent to use

# Cleanup configuration (optional)
cleanup:
  on: [merged, closed]          # When to cleanup
  delay: 5m                     # Grace period before cleanup
```

### Template Variables

Variables available in all templates (`key_template`, `clone_name_template`, `branch_template`, `prompt.template`, `session.name_template`):

#### GitHub Variables
| Variable | Description | Example |
|----------|-------------|---------|
| `{repo}` | Full repo name | `myorg/api` |
| `{repo_short}` | Repo name only | `api` |
| `{number}` | PR number | `123` |
| `{title}` | PR title | `Add OAuth support` |
| `{url}` | PR URL | `https://github.com/...` |
| `{head_ref}` | Source branch | `feature-oauth` |
| `{base_ref}` | Target branch | `main` |
| `{author}` | PR author | `username` |
| `{labels}` | Comma-separated labels | `enhancement,auth` |

#### Linear Variables
| Variable | Description | Example |
|----------|-------------|---------|
| `{identifier}` | Issue ID | `ABC-123` |
| `{team}` | Team key | `ENG` |
| `{title}` | Issue title | `Implement OAuth` |
| `{description}` | Issue description | Full markdown |
| `{url}` | Issue URL | `https://linear.app/...` |
| `{state}` | Current state | `In Progress` |
| `{labels}` | Comma-separated labels | `backend,auth` |
| `{priority}` | Priority number | `2` |
| `{title_slug}` | URL-safe title | `implement-oauth` |

#### Context Variables (set by MCP plugin)
| Variable | Description |
|----------|-------------|
| `{workspace}` | Devcontainer workspace path |
| `{branch}` | Current git branch |
| `{source_url}` | PR/issue URL |
| `{source_type}` | `github_pr`, `linear_issue` |

### Default Poll Configs

ocdc ships with default configs in `share/ocdc/polls/`:

- **github-reviews.yaml**: PRs where your review is requested (enabled by default)
- **linear-assigned.yaml**: Linear issues assigned to you (disabled, requires setup)

Copy these to `~/.config/ocdc/polls/` and customize as needed.

## License

MIT
