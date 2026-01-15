import { 
  mkdirSync, existsSync, readdirSync, unlinkSync, copyFileSync 
} from "fs"
import { join, dirname, basename } from "path"
import { fileURLToPath } from "url"
import { tool } from "@opencode-ai/plugin/tool"

import {
  loadSession,
  saveSession,
  deleteSession,
  resolveWorkspace,
  resolveWorktreeWorkspace,
  shouldRunOnHost,
  getSessionsDir,
  runWithTimeout,
  shellQuote,
} from "./helpers.js"

// Import from new core modules
import {
  up,
  upBackground,
  exec,
  isContainerRunning,
  checkDevcontainerCli,
  getOverridePath,
  getJob,
  cleanupJobs,
  JOB_STATUS,
  PATHS,
  // Worktree imports
  createWorktreeWorkspace,
  getRepoRoot,
  isWorktree,
  // Workspaces imports
  listAllWorkspaces,
  getWorkspaceStatus,
  findStaleWorkspaces,
  formatWorkspace,
} from "./core/index.js"

// Timeout for init operations (2 seconds)
const INIT_TIMEOUT_MS = 2000

const __dirname = dirname(fileURLToPath(import.meta.url))

// ============ Internal Functions ============

async function installCommands(client) {
  try {
    const paths = await client.path.get()
    const configDir = paths.data?.config
    if (!configDir) return
    
    const commandDir = join(configDir, "command")
    mkdirSync(commandDir, { recursive: true })
    
    // Install all command files
    const commands = ["devcontainer.md", "worktree.md", "workspaces.md"]
    for (const cmd of commands) {
      const sourceFile = join(__dirname, "command", cmd)
      const destFile = join(commandDir, cmd)
      if (existsSync(sourceFile)) {
        copyFileSync(sourceFile, destFile)
      }
    }
    
    // Clean up old command file names
    const oldFiles = ["ocdc-use.md", "ocdc.md"]
    for (const oldName of oldFiles) {
      const oldFile = join(commandDir, oldName)
      if (existsSync(oldFile)) {
        unlinkSync(oldFile)
      }
    }
  } catch {}
}

async function cleanupStaleSessions(client) {
  const sessionsDir = getSessionsDir()
  if (!existsSync(sessionsDir)) return
  
  try {
    const response = await client.session.list()
    const sessions = response.data || []
    const activeIDs = new Set(sessions.map(s => s.id))
    
    for (const file of readdirSync(sessionsDir)) {
      if (!file.endsWith(".json")) continue
      const sessionID = file.replace(".json", "")
      if (!activeIDs.has(sessionID)) {
        unlinkSync(join(sessionsDir, file))
      }
    }
  } catch {}
}

/**
 * Build devcontainer exec command string for bash interception
 * 
 * @param {string} workspace - Workspace path (will be shell-quoted)
 * @param {string} command - Command to execute (passed verbatim to shell)
 * @returns {string} Shell command string
 */
function buildDevcontainerExecCommand(workspace, command) {
  const overridePath = getOverridePath(workspace)
  const hasOverride = existsSync(overridePath)
  
  let cmd = `devcontainer exec --workspace-folder ${shellQuote(workspace)}`
  if (hasOverride) {
    cmd += ` --override-config ${shellQuote(overridePath)}`
  }
  cmd += ` -- ${command}`
  
  return cmd
}

// ============ Plugin Export ============

export const devcontainers = async ({ client }) => {
  // Install command files if needed (don't block on slow API)
  runWithTimeout(() => installCommands(client), INIT_TIMEOUT_MS)
  
  // Cleanup stale sessions (don't block on slow API)
  runWithTimeout(() => cleanupStaleSessions(client), INIT_TIMEOUT_MS)
  
  // Cleanup old jobs (don't block)
  runWithTimeout(() => cleanupJobs(), INIT_TIMEOUT_MS)
  
  return {
    tool: {
      // Execute command in devcontainer
      devcontainer_exec: tool({
        description: "Execute a command in the current devcontainer context. IMPORTANT: Only use this tool when a devcontainer session is active (set via /devcontainer command). For normal shell commands, use the bash tool instead.",
        args: {
          command: tool.schema.string().describe("Command to execute"),
        },
        async execute(args, ctx) {
          const { sessionID } = ctx
          const { command } = args
          
          const session = loadSession(sessionID)
          if (!session?.workspace) {
            return "Error: No devcontainer context set for this session. Use `/devcontainer <branch>` first."
          }
          
          // Check if container is still starting
          if (session.starting) {
            const job = await getJob(session.workspace)
            if (job) {
              if (job.status === JOB_STATUS.PENDING || job.status === JOB_STATUS.RUNNING) {
                return `Container is still starting for ${session.repoName}/${session.branch}.\n\n` +
                       `Please wait and try again, or use \`/devcontainer\` to check status.`
              }
              if (job.status === JOB_STATUS.FAILED) {
                return `Container failed to start: ${job.error}\n\n` +
                       `Use \`/devcontainer ${session.branch}\` to retry.`
              }
              if (job.status === JOB_STATUS.COMPLETED) {
                // Container is ready - update session to remove starting flag
                saveSession(sessionID, {
                  ...session,
                  starting: false,
                })
              }
            }
          }
          
          try {
            // Use the core exec function
            const result = await exec(session.workspace, command, { signal: ctx.abort })
            
            if (result.exitCode !== 0) {
              return `Command failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`
            }
            
            return result.stdout
          } catch (err) {
            if (err.name === 'AbortError') {
              return `Command cancelled.`
            }
            return `Command failed: ${err.message}`
          }
        }
      }),
      
      // Interactive command for manual devcontainer targeting
      devcontainer: tool({
        description: "Set active devcontainer for this session. Use 'off' to disable. Set create=true to create a new workspace if it doesn't exist.",
        args: {
          target: tool.schema.string().optional().describe(
            "Branch name (e.g., 'feature-x'), 'off' to disable, or empty for status"
          ),
          create: tool.schema.string().optional().describe(
            "Set to 'true' to create the workspace if it doesn't exist (requires confirmation)"
          ),
        },
        async execute(args, ctx) {
          const { sessionID, abort: signal } = ctx
          const { target, create } = args
          const shouldCreate = create === "true" || create === true
          
          // Verify devcontainer CLI is installed
          const hasCli = await checkDevcontainerCli()
          if (!hasCli) {
            return "devcontainer CLI not found.\n\nInstall with: `npm install -g @devcontainers/cli`"
          }
          
          // Status request (no target)
          if (!target || target.trim() === "") {
            const session = loadSession(sessionID)
            if (!session) {
              return "No devcontainer active for this session.\n\n" +
                     "Use `/devcontainer <branch>` to target a devcontainer."
            }
            
            // Check for background job status
            if (session.starting) {
              const job = await getJob(session.workspace)
              if (job) {
                if (job.status === JOB_STATUS.PENDING) {
                  return `Current devcontainer: ${session.repoName}/${session.branch}\n` +
                         `Workspace: ${session.workspace}\n` +
                         `Status: Starting (pending)...\n\n` +
                         `Container start is queued. Please wait.`
                }
                if (job.status === JOB_STATUS.RUNNING) {
                  return `Current devcontainer: ${session.repoName}/${session.branch}\n` +
                         `Workspace: ${session.workspace}\n` +
                         `Status: Starting (in progress)...\n\n` +
                         `Container is being built/started. This may take a few minutes.`
                }
                if (job.status === JOB_STATUS.FAILED) {
                  return `Current devcontainer: ${session.repoName}/${session.branch}\n` +
                         `Workspace: ${session.workspace}\n` +
                         `Status: Failed to start\n\n` +
                         `Error: ${job.error}\n\n` +
                         `Use \`/devcontainer ${session.branch}\` to retry.`
                }
                if (job.status === JOB_STATUS.COMPLETED) {
                  // Update session to remove starting flag
                  saveSession(sessionID, {
                    ...session,
                    starting: false,
                  })
                  return `Current devcontainer: ${session.repoName}/${session.branch}\n` +
                         `Workspace: ${session.workspace}\n` +
                         `Port: ${job.port}\n` +
                         `Status: Running\n\n` +
                         `Container is ready! All commands will run inside this container.\n` +
                         `Use \`/devcontainer off\` to disable.`
                }
              }
            }
            
            const running = await isContainerRunning(session.workspace)
            return `Current devcontainer: ${session.repoName}/${session.branch}\n` +
                   `Workspace: ${session.workspace}\n` +
                   `Status: ${running ? "Running" : "Not running"}\n` +
                   `\nUse \`/devcontainer off\` to disable.`
          }
          
          // Disable request
          if (target === "off") {
            const session = loadSession(sessionID)
            deleteSession(sessionID)
            if (session) {
              return `Devcontainer mode disabled. Commands will now run on the host.`
            }
            return "No devcontainer was active for this session."
          }
          
          // Resolve workspace (check if clone already exists)
          const resolved = resolveWorkspace(target)
          
          if (!resolved) {
            // Workspace doesn't exist - start it in background (non-blocking)
            try {
              const result = await upBackground(target, {
                cwd: process.cwd(),
              })
              
              saveSession(sessionID, {
                branch: result.branch,
                workspace: result.workspace,
                repoName: result.repo,
                starting: true,  // Mark as starting
              })
              
              return `Starting container for ${result.repo}/${result.branch}...\n` +
                     `Workspace: ${result.workspace}\n\n` +
                     `Container is being created in the background. This may take a few minutes.\n` +
                     `Use \`/devcontainer\` to check status.\n\n` +
                     `Session is now targeting this container. Commands will work once it's ready.`
            } catch (err) {
              // Quick validation failed (e.g., not in git repo, no devcontainer.json)
              if (!shouldCreate) {
                return `Cannot create devcontainer for '${target}'.\n\n` +
                       `Error: ${err.message}\n\n` +
                       `Make sure you're in a git repository with a devcontainer.json file.`
              }
              
              return `Failed to create workspace: ${err.message}`
            }
          }
          
          if (resolved.ambiguous) {
            const options = resolved.matches
              .map(m => `  - ${m.repoName}/${m.branch}`)
              .join("\n")
            return `Ambiguous branch '${target}' found in multiple repos:\n${options}\n\n` +
                   `Use \`/devcontainer <repo>/${target}\` to specify.`
          }
          
          const { workspace, repoName, branch } = resolved
          
          // Check if container is running
          const isRunning = await isContainerRunning(workspace)
          if (!isRunning) {
            // Container exists but not running - start it in background (non-blocking)
            try {
              await upBackground(workspace)
              
              saveSession(sessionID, { 
                branch, 
                workspace, 
                repoName,
                starting: true,  // Mark as starting
              })
              
              return `Starting container for ${repoName}/${branch}...\n` +
                     `Workspace: ${workspace}\n\n` +
                     `Container is starting in the background. This may take a minute.\n` +
                     `Use \`/devcontainer\` to check status.\n\n` +
                     `Session is now targeting this container. Commands will work once it's ready.`
            } catch (err) {
              // Quick validation failed
              return `Failed to start container: ${err.message}`
            }
          }
          
          // Save session state
          saveSession(sessionID, {
            branch,
            workspace,
            repoName,
          })
          
          return `Session now targeting: ${repoName}/${branch}\n` +
                 `Workspace: ${workspace}\n\n` +
                 `All commands will run inside this container.\n` +
                 `Use \`/devcontainer off\` to disable, or prefix with \`HOST:\` to run on host.`
        }
      }),
      
      // Interactive command for manual worktree targeting
      worktree: tool({
        description: "Set active git worktree for this session. Use 'off' to disable. Worktrees provide isolated branch work without devcontainers.",
        args: {
          target: tool.schema.string().optional().describe(
            "Branch name (e.g., 'feature-x'), 'off' to disable, or empty for status"
          ),
          workdir: tool.schema.string().optional().describe(
            "Working directory (git repository) to create worktree from. Defaults to current directory."
          ),
        },
        async execute(args, ctx) {
          const { sessionID } = ctx
          const { target, workdir } = args
          const cwd = workdir || process.cwd()
          
          // Status request (no target)
          if (!target || target.trim() === "") {
            const session = loadSession(sessionID)
            if (!session) {
              return "No workspace active for this session.\n\n" +
                     "Use `/worktree <branch>` to create/target a worktree."
            }
            
            if (session.type !== "worktree") {
              return `Current session is targeting a devcontainer, not a worktree.\n` +
                     `Use \`/devcontainer\` to check devcontainer status, or \`/devcontainer off\` first.`
            }
            
            return `Current worktree: ${session.repoName}/${session.branch}\n` +
                   `Workspace: ${session.workspace}\n` +
                   `Main repo: ${session.mainRepo}\n` +
                   `\nAll bash commands will run in this worktree directory.\n` +
                   `Use \`/worktree off\` to disable.`
          }
          
          // Disable request
          if (target === "off") {
            const session = loadSession(sessionID)
            deleteSession(sessionID)
            if (session && session.type === "worktree") {
              return `Worktree mode disabled. Commands will now run in the current directory.`
            }
            if (session) {
              return `Session was targeting a devcontainer, not a worktree. Session cleared.`
            }
            return "No workspace was active for this session."
          }
          
          // Check if we're in a git repo
          const repoRoot = await getRepoRoot(cwd)
          
          if (!repoRoot) {
            return `Not in a git repository (checked: ${cwd}).\n\n` +
                   `Please call this tool with the \`workdir\` parameter set to the project directory.\n` +
                   `Example: worktree(target: "${target}", workdir: "/path/to/your/repo")`
          }
          
          // Check if already in a worktree
          if (await isWorktree(repoRoot)) {
            return `Already in a worktree.\n\n` +
                   `Create new worktrees from the main repository, not from within another worktree.`
          }
          
          // Check if worktree already exists
          const resolved = resolveWorktreeWorkspace(target)
          
          if (resolved && !resolved.ambiguous) {
            const { workspace, repoName, branch, mainRepo } = resolved
            
            // Save session state
            saveSession(sessionID, {
              type: "worktree",
              branch,
              workspace,
              repoName,
              mainRepo,
            })
            
            return `Session now targeting worktree: ${repoName}/${branch}\n` +
                   `Workspace: ${workspace}\n\n` +
                   `All bash commands will run in this worktree directory.\n` +
                   `Use \`/worktree off\` to disable, or prefix with \`HOST:\` to run in original directory.`
          }
          
          if (resolved?.ambiguous) {
            const options = resolved.matches
              .map(m => `  - ${m.repo}/${m.branch}`)
              .join("\n")
            return `Ambiguous branch '${target}' found in multiple repos:\n${options}\n\n` +
                   `Use \`/worktree <repo>/${target}\` to specify.`
          }
          
          // Create new worktree
          try {
            const result = await createWorktreeWorkspace({
              repoRoot,
              branch: target,
            })
            
            saveSession(sessionID, {
              type: "worktree",
              branch: result.branch,
              workspace: result.workspace,
              repoName: result.repoName,
              mainRepo: result.mainRepo,
            })
            
            return `Created worktree for ${result.repoName}/${result.branch}\n` +
                   `Workspace: ${result.workspace}\n\n` +
                   `All bash commands will run in this worktree directory.\n` +
                   `Gitignored files (secrets, .env) have been copied from main repo.\n` +
                   `Use \`/worktree off\` to disable.`
          } catch (err) {
            return `Failed to create worktree: ${err.message}`
          }
        }
      }),
      
      // Workspace management tool
      workspaces: tool({
        description: "List and manage workspaces (worktrees and devcontainer clones). Use 'cleanup' to find stale workspaces.",
        args: {
          action: tool.schema.string().optional().describe(
            "'cleanup' to identify stale workspaces, or empty to list all"
          ),
        },
        async execute(args, ctx) {
          const { action } = args
          
          if (action === 'cleanup') {
            // Find stale workspaces
            const stale = await findStaleWorkspaces({ maxAgeDays: 7 })
            
            if (stale.length === 0) {
              return `No stale workspaces found.\n\n` +
                     `All workspaces have been accessed within the last 7 days.`
            }
            
            let output = `Found ${stale.length} stale workspace(s) (not accessed in 7+ days):\n\n`
            
            for (const ws of stale) {
              const status = await getWorkspaceStatus(ws.workspace)
              output += formatWorkspace(ws, status) + '\n'
              output += `  Path: ${ws.workspace}\n`
              if (ws.hasUncommitted) {
                output += `  ⚠️  Has uncommitted changes!\n`
              }
              output += '\n'
            }
            
            output += `To remove a workspace:\n`
            output += `- Worktrees: \`git worktree remove <path>\` from main repo\n`
            output += `- Clones: \`rm -rf <path>\` (and stop any running containers)\n`
            
            return output
          }
          
          // Default: list all workspaces
          const workspaces = await listAllWorkspaces()
          
          if (workspaces.length === 0) {
            return `No workspaces found.\n\n` +
                   `Use \`/devcontainer <branch>\` to create a devcontainer clone, or\n` +
                   `Use \`/worktree <branch>\` to create a worktree.`
          }
          
          let output = `Found ${workspaces.length} workspace(s):\n\n`
          
          // Group by type
          const clones = workspaces.filter(w => w.type === 'clone')
          const worktrees = workspaces.filter(w => w.type === 'worktree')
          
          if (clones.length > 0) {
            output += `**Devcontainer Clones** (${clones.length}):\n`
            for (const ws of clones) {
              const status = await getWorkspaceStatus(ws.workspace)
              output += `  ${formatWorkspace(ws, status)}\n`
            }
            output += '\n'
          }
          
          if (worktrees.length > 0) {
            output += `**Worktrees** (${worktrees.length}):\n`
            for (const ws of worktrees) {
              const status = await getWorkspaceStatus(ws.workspace)
              output += `  ${formatWorkspace(ws, status)}\n`
            }
            output += '\n'
          }
          
          output += `Use \`/workspaces cleanup\` to find stale workspaces.`
          
          return output
        }
      }),
    },
    
    // Intercept bash commands to run in workspace
    "tool.execute.before": async (input, output) => {
      // Only intercept bash commands
      if (input.tool !== "bash") return
      
      const session = loadSession(input.sessionID)
      if (!session?.workspace) return
      
      // If workdir is specified and is not within the workspace, don't intercept
      // This handles the case where the user/Claude is working in a different directory
      const workdir = output.args?.workdir
      if (workdir && !workdir.startsWith(session.workspace)) {
        return
      }
      
      let cmd = output.args?.command?.trim()
      if (!cmd) return
      
      const hostCheck = shouldRunOnHost(cmd)
      
      // Check for HOST: escape hatch
      if (hostCheck === "escape") {
        output.args.command = cmd.replace(/^HOST:\s*/i, "")
        return
      }
      
      // Check if command should run on host
      if (hostCheck) return
      
      // Handle worktree sessions - just set workdir, no container wrapping
      if (session.type === "worktree") {
        output.args.workdir = session.workspace
        return
      }
      
      // Handle devcontainer sessions
      // Check if container is still starting - provide helpful error instead of cryptic failure
      if (session.starting) {
        const job = await getJob(session.workspace)
        if (job && (job.status === JOB_STATUS.PENDING || job.status === JOB_STATUS.RUNNING)) {
          // Rewrite to echo a helpful message instead of failing
          output.args.command = `echo "Container is still starting for ${session.repoName}/${session.branch}. Please wait and try again, or use /devcontainer to check status." && exit 1`
          return
        }
        if (job && job.status === JOB_STATUS.COMPLETED) {
          // Container is ready - update session (fire-and-forget)
          saveSession(input.sessionID, { ...session, starting: false })
        }
      }
      
      // Wrap with devcontainer exec (using safe command builder to prevent shell injection)
      output.args.command = buildDevcontainerExecCommand(session.workspace, cmd)
    }
  }
}

// Default export for OpenCode plugin discovery
export default devcontainers
