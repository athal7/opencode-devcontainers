/**
 * Git operations for opencode-devcontainers
 * 
 * Provides async wrappers around git commands using child_process.
 * Zero-dependency implementation.
 */

import { spawn } from 'child_process'

/**
 * Run a git command and return the output
 * 
 * @param {string[]} args - Git command arguments
 * @param {string} cwd - Working directory
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', data => {
      stdout += data.toString()
    })

    child.stderr.on('data', data => {
      stderr += data.toString()
    })

    child.on('close', exitCode => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode })
    })

    child.on('error', reject)
  })
}

/**
 * Check if a directory is a git repository
 * 
 * @param {string} dir - Directory to check
 * @returns {Promise<boolean>}
 */
export async function isGitRepo(dir) {
  try {
    const result = await runGit(['rev-parse', '--git-dir'], dir)
    return result.exitCode === 0
  } catch {
    return false
  }
}

/**
 * Get the root directory of a git repository
 * 
 * @param {string} dir - Directory within the repository
 * @returns {Promise<string|null>} Absolute path to repo root, or null if not in a repo
 */
export async function getRepoRoot(dir) {
  try {
    const result = await runGit(['rev-parse', '--show-toplevel'], dir)
    if (result.exitCode === 0 && result.stdout) {
      return result.stdout
    }
    return null
  } catch {
    return null
  }
}

/**
 * Get the current branch name
 * 
 * @param {string} dir - Repository directory
 * @returns {Promise<string|null>} Branch name, or null if not in a repo
 */
export async function getCurrentBranch(dir) {
  try {
    const result = await runGit(['branch', '--show-current'], dir)
    if (result.exitCode === 0 && result.stdout) {
      return result.stdout
    }
    return null
  } catch {
    return null
  }
}

/**
 * Get the remote URL for a repository
 * 
 * @param {string} dir - Repository directory
 * @param {string} remote - Remote name (default: 'origin')
 * @returns {Promise<string|null>} Remote URL, or null if not set
 */
export async function getRemoteUrl(dir, remote = 'origin') {
  try {
    const result = await runGit(['remote', 'get-url', remote], dir)
    if (result.exitCode === 0 && result.stdout) {
      return result.stdout
    }
    return null
  } catch {
    return null
  }
}

/**
 * Clone a git repository
 * 
 * @param {object} options
 * @param {string} options.url - Repository URL or local path
 * @param {string} options.dest - Destination directory
 * @param {string} [options.branch] - Branch to clone (optional)
 * @param {string} [options.reference] - Reference repository for efficiency (optional)
 * @param {boolean} [options.dissociate] - Dissociate from reference (default: true when reference provided)
 * @returns {Promise<void>}
 */
export async function clone(options) {
  const { url, dest, branch, reference, dissociate = true } = options

  const args = ['clone']

  if (reference) {
    args.push('--reference', reference)
    if (dissociate) {
      args.push('--dissociate')
    }
  }

  if (branch) {
    args.push('--branch', branch)
  }

  args.push(url, dest)

  const result = await runGit(args, process.cwd())
  if (result.exitCode !== 0) {
    throw new Error(`git clone failed: ${result.stderr}`)
  }
}

/**
 * Checkout a branch in a repository
 * 
 * @param {string} dir - Repository directory
 * @param {string} branch - Branch name
 * @param {object} [options]
 * @param {boolean} [options.createBranch] - Create branch if it doesn't exist
 * @returns {Promise<void>}
 */
export async function checkout(dir, branch, options = {}) {
  const { createBranch = false } = options

  const args = ['checkout']
  if (createBranch) {
    args.push('-b')
  }
  args.push(branch)

  const result = await runGit(args, dir)
  if (result.exitCode !== 0) {
    throw new Error(`git checkout failed: ${result.stderr}`)
  }
}

/**
 * Fetch from a remote
 * 
 * @param {string} dir - Repository directory
 * @param {string} [remote] - Remote name (default: all remotes)
 * @returns {Promise<void>}
 */
export async function fetch(dir, remote) {
  const args = ['fetch']
  if (remote) {
    args.push(remote)
  }

  const result = await runGit(args, dir)
  // Fetch can fail gracefully (no network, etc.)
  if (result.exitCode !== 0) {
    // Don't throw, just log to stderr
    console.error(`git fetch warning: ${result.stderr}`)
  }
}

/**
 * Get list of files ignored by git but present in working tree
 * 
 * @param {string} dir - Repository directory
 * @returns {Promise<string[]>} Array of relative paths
 */
export async function listIgnoredFiles(dir) {
  try {
    const result = await runGit(['ls-files', '--others', '--ignored', '--exclude-standard'], dir)
    if (result.exitCode !== 0 || !result.stdout) {
      return []
    }
    return result.stdout.split('\n').filter(Boolean)
  } catch {
    return []
  }
}

// ============ Worktree Operations ============

/**
 * Check if a directory is a git worktree (not the main repo)
 * 
 * A worktree has a .git file (not directory) that points to the main repo's
 * .git/worktrees/<name> directory.
 * 
 * @param {string} dir - Directory to check
 * @returns {Promise<boolean>}
 */
export async function isWorktree(dir) {
  try {
    const { stat, readFile } = await import('fs/promises')
    const gitPath = `${dir}/.git`
    
    // Check if .git exists and is a file (not directory)
    const gitStat = await stat(gitPath).catch(() => null)
    if (!gitStat || !gitStat.isFile()) {
      return false
    }
    
    // Verify it contains a gitdir reference pointing to a worktree administrative directory
    const content = await readFile(gitPath, 'utf-8')
    return content.startsWith('gitdir:') && /[/\\]worktrees[/\\][^/\\]+\s*$/.test(content)
  } catch {
    return false
  }
}

/**
 * Get the main repository path from a worktree
 * 
 * @param {string} worktreePath - Path to the worktree
 * @returns {Promise<string|null>} Path to main repo, or null if not a worktree
 */
export async function getWorktreeMainRepo(worktreePath) {
  try {
    // Check if it's a worktree first
    if (!await isWorktree(worktreePath)) {
      return null
    }
    
    // Use git rev-parse to get the main worktree (common dir)
    const result = await runGit(['rev-parse', '--git-common-dir'], worktreePath)
    if (result.exitCode !== 0 || !result.stdout) {
      return null
    }
    
    // The common dir is .git in the main repo, we need the repo root
    // e.g., /path/to/main/.git -> /path/to/main
    const commonDir = result.stdout
    if (commonDir.endsWith('/.git')) {
      return commonDir.slice(0, -5)
    }
    if (commonDir.endsWith('.git')) {
      return commonDir.slice(0, -4)
    }
    
    // Fallback: get parent of .git directory
    const { dirname } = await import('path')
    return dirname(commonDir)
  } catch {
    return null
  }
}

/**
 * Create a git worktree
 * 
 * @param {string} mainRepo - Path to the main repository
 * @param {string} branch - Branch name
 * @param {string} destPath - Destination path for the worktree
 * @param {object} [options]
 * @param {boolean} [options.createBranch=true] - Create branch if it doesn't exist
 * @returns {Promise<void>}
 */
export async function createWorktree(mainRepo, branch, destPath, options = {}) {
  const { createBranch = true } = options
  
  const args = ['worktree', 'add']
  
  if (createBranch) {
    args.push('-b', branch)
  }
  
  args.push(destPath)
  
  if (!createBranch) {
    args.push(branch)
  }
  
  const result = await runGit(args, mainRepo)
  if (result.exitCode !== 0) {
    throw new Error(`git worktree add failed: ${result.stderr}`)
  }
}

/**
 * Remove a git worktree
 * 
 * @param {string} mainRepo - Path to the main repository
 * @param {string} worktreePath - Path to the worktree to remove
 * @param {object} [options]
 * @param {boolean} [options.force=false] - Force removal even if dirty
 * @returns {Promise<void>}
 */
export async function removeWorktree(mainRepo, worktreePath, options = {}) {
  const { force = false } = options
  
  const args = ['worktree', 'remove']
  
  if (force) {
    args.push('--force')
  }
  
  args.push(worktreePath)
  
  const result = await runGit(args, mainRepo)
  if (result.exitCode !== 0) {
    throw new Error(`git worktree remove failed: ${result.stderr}`)
  }
}

/**
 * List all worktrees for a repository
 * 
 * @param {string} repoPath - Path to any worktree or the main repo
 * @returns {Promise<Array<{path: string, branch: string, isMain: boolean}>>}
 */
export async function listWorktrees(repoPath) {
  try {
    const result = await runGit(['worktree', 'list', '--porcelain'], repoPath)
    if (result.exitCode !== 0 || !result.stdout) {
      return []
    }
    
    // Parse porcelain output
    // Format:
    // worktree /path/to/worktree
    // HEAD <commit>
    // branch refs/heads/<branch>
    // (blank line)
    
    const worktrees = []
    const entries = result.stdout.split('\n\n').filter(Boolean)
    
    for (const entry of entries) {
      const lines = entry.split('\n')
      let path = ''
      let branch = ''
      let isMain = false
      
      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          path = line.slice(9)
        } else if (line.startsWith('branch refs/heads/')) {
          branch = line.slice(18)
        } else if (line === 'bare') {
          // Skip bare repos
          continue
        }
      }
      
      if (path) {
        // First entry is always the main worktree
        if (worktrees.length === 0) {
          isMain = true
        }
        
        worktrees.push({ path, branch, isMain })
      }
    }
    
    return worktrees
  } catch {
    return []
  }
}

export default {
  isGitRepo,
  getRepoRoot,
  getCurrentBranch,
  getRemoteUrl,
  clone,
  checkout,
  fetch,
  listIgnoredFiles,
  isWorktree,
  getWorktreeMainRepo,
  createWorktree,
  removeWorktree,
  listWorktrees,
}
