---
description: Target a devcontainer - /devcontainer <branch>, off. Or remove: /devcontainer rm <branch>, or rm all
---

Call the `devcontainer` tool with `target` set to: $ARGUMENTS

If no arguments provided, call `devcontainer` with no target to show current status.

If a `rm` command returns a message asking for confirmation, ask the user if they want to proceed. If they agree, call the tool again with the same arguments plus `confirmed: true`.
