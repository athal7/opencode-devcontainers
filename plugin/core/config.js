/**
 * Configuration handling for opencode-devcontainers
 * 
 * Handles:
 * - Reading devcontainer.json files
 * - Generating override configs with port mappings
 * - Loading user configuration
 */

import { join, basename } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import childProcess from 'child_process'
import { PATHS, pathId } from './paths.js'

// Default configuration values
const DEFAULT_CONFIG = {
  portRangeStart: 13000,
  portRangeEnd: 13099,
}

/**
 * Get the path for an override config file
 * 
 * @param {string} workspace - Workspace path
 * @returns {string} Path to override config
 */
export function getOverridePath(workspace) {
  const id = pathId(workspace)
  return join(PATHS.overrides, `${id}.json`)
}

/**
 * Read devcontainer.json from a workspace
 * 
 * Checks for:
 * 1. .devcontainer/devcontainer.json
 * 2. .devcontainer.json (in root)
 * 
 * @param {string} workspace - Workspace path
 * @returns {Promise<object|null>} Parsed config or null if not found
 */
export async function readDevcontainerJson(workspace) {
  const paths = [
    join(workspace, '.devcontainer', 'devcontainer.json'),
    join(workspace, '.devcontainer.json'),
  ]

  for (const path of paths) {
    if (existsSync(path)) {
      try {
        const content = await readFile(path, 'utf-8')
        return JSON.parse(content)
      } catch {
        // Try next path
      }
    }
  }

  return null
}

/**
 * Detect the internal port from devcontainer config
 * 
 * Looks for:
 * 1. forwardPorts array (first element)
 * 2. runArgs -p flag (HOST:CONTAINER or CONTAINER)
 * 
 * @param {object|null} config - Devcontainer config
 * @returns {number} Internal port (defaults to 3000)
 */
export function detectInternalPort(config) {
  if (!config) return 3000

  // Check forwardPorts
  if (Array.isArray(config.forwardPorts) && config.forwardPorts.length > 0) {
    const port = config.forwardPorts[0]
    if (typeof port === 'number') return port
    if (typeof port === 'string') {
      const parsed = parseInt(port, 10)
      if (!isNaN(parsed)) return parsed
    }
  }

  // Check runArgs for -p flag
  if (Array.isArray(config.runArgs)) {
    for (let i = 0; i < config.runArgs.length; i++) {
      const arg = config.runArgs[i]
      
      // Handle -p HOST:CONTAINER
      if (arg === '-p' && i + 1 < config.runArgs.length) {
        const portArg = config.runArgs[i + 1]
        if (portArg.includes(':')) {
          const parts = portArg.split(':')
          const containerPort = parseInt(parts[parts.length - 1], 10)
          if (!isNaN(containerPort)) return containerPort
        }
      }
      
      // Handle HOST:CONTAINER format directly
      if (/^\d+:\d+$/.test(arg)) {
        const parts = arg.split(':')
        const containerPort = parseInt(parts[1], 10)
        if (!isNaN(containerPort)) return containerPort
      }
    }
  }

  return 3000
}

/**
 * Remove port mappings from runArgs
 * 
 * Removes:
 * - -p flag and its following argument
 * - Standalone HOST:CONTAINER patterns
 * 
 * @param {string[]} runArgs - Original runArgs
 * @returns {string[]} Filtered runArgs
 */
function removePortArgs(runArgs) {
  if (!Array.isArray(runArgs)) return []

  const result = []
  let skipNext = false

  for (const arg of runArgs) {
    if (skipNext) {
      skipNext = false
      continue
    }

    if (arg === '-p') {
      skipNext = true
      continue
    }

    // Skip HOST:PORT patterns
    if (/^\d+:\d+$/.test(arg)) {
      continue
    }

    result.push(arg)
  }

  return result
}

/**
 * Generate an override config with port mapping
 * 
 * Creates a modified devcontainer.json that:
 * - Maps the internal port to the assigned external port
 * - Sets a unique container name
 * - Sets the correct workspaceFolder
 * 
 * @param {string} workspace - Workspace path
 * @param {number} port - External port to use
 * @param {string} [repoName] - Repository name for workspaceFolder (defaults to basename of workspace)
 * @returns {Promise<string>} Path to generated override config
 */
export async function generateOverrideConfig(workspace, port, repoName) {
  const baseConfig = await readDevcontainerJson(workspace) || {}
  const internalPort = detectInternalPort(baseConfig)
  const workspaceName = basename(workspace) || repoName 

  // Build override config
  // Remove forwardPorts and appPort to prevent devcontainer CLI from setting up
  // its own port forwarding which would conflict with our explicit -p in runArgs
  const { forwardPorts, appPort, ...restConfig } = baseConfig
  const override = {
    ...restConfig,
    name: `${workspaceName} (port ${port})`,
    workspaceFolder: `/workspaces/${workspaceName}`,
    runArgs: [
      ...removePortArgs(restConfig.runArgs),
      '-p',
      `${port}:${internalPort}`,
    ],
  }

  // Write override file
  const overridePath = getOverridePath(workspace)
  await mkdir(PATHS.overrides, { recursive: true })
  await writeFile(overridePath, JSON.stringify(override, null, 2))

  return overridePath
}

export async function checkCommand(command, platform = process.platform) {
  return new Promise(resolve => {
    const locator = platform === 'win32' ? 'where' : 'which'
    const child = childProcess.spawn(locator, [command], { stdio: 'ignore' })
    child.once('close', code => resolve(code === 0))
    child.once('error', () => resolve(false))
  })
}

function isPodmanPath(command) {
  return /(^|[\\/])podman(?:\.exe)?$/i.test(command)
}

async function detectComposePath(dockerPath) {
  if (await checkCommand('podman-compose')) return 'podman-compose'
  if (await checkCommand('docker-compose')) return 'docker-compose'

  throw new Error(
    `Unsupported container runtime configuration: no compatible Compose command is available for Podman (${dockerPath}).`
  )
}

/**
 * Load user configuration
 * 
 * @returns {Promise<object>} Merged user config with defaults
 */
export async function loadUserConfig() {
  let userConfig = {}
  try {
    const content = await readFile(PATHS.configFile, 'utf-8')
    userConfig = JSON.parse(content)
  } catch {
  }

  const config = { ...DEFAULT_CONFIG, ...userConfig }

  if (!config.dockerPath) {
    if (await checkCommand('docker')) {
      config.dockerPath = 'docker'
    } else if (await checkCommand('podman')) {
      config.dockerPath = 'podman'
    } else {
      config.dockerPath = 'docker'
    }
  }

  if (!config.dockerComposePath && isPodmanPath(config.dockerPath)) {
    config.dockerComposePath = await detectComposePath(config.dockerPath)
  }

  return config
}

export default {
  getOverridePath,
  readDevcontainerJson,
  detectInternalPort,
  generateOverrideConfig,
  loadUserConfig,
  checkCommand,
}
