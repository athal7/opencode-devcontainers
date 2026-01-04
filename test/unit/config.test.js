/**
 * Tests for plugin/core/config.js
 * 
 * Run with: node --test test/unit/config.test.js
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { join, basename } from 'path'
import { homedir } from 'os'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'

// Module under test
import { 
  generateOverrideConfig,
  readDevcontainerJson,
  detectInternalPort,
  getOverridePath,
  loadUserConfig
} from '../../plugin/core/config.js'
import { PATHS, pathId } from '../../plugin/core/paths.js'

describe('getOverridePath', () => {
  test('returns path under overrides directory', () => {
    const workspace = '/some/workspace'
    const path = getOverridePath(workspace)
    
    assert.ok(path.startsWith(PATHS.overrides))
    assert.ok(path.includes(pathId(workspace)))
    assert.ok(path.endsWith('.json'))
  })
})

describe('readDevcontainerJson', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-readdc-' + Date.now())

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('reads .devcontainer/devcontainer.json', async () => {
    mkdirSync(join(testDir, '.devcontainer'), { recursive: true })
    writeFileSync(
      join(testDir, '.devcontainer', 'devcontainer.json'),
      JSON.stringify({ name: 'test', forwardPorts: [3000] })
    )
    
    const config = await readDevcontainerJson(testDir)
    assert.strictEqual(config.name, 'test')
    assert.deepStrictEqual(config.forwardPorts, [3000])
  })

  test('reads .devcontainer.json in root', async () => {
    writeFileSync(
      join(testDir, '.devcontainer.json'),
      JSON.stringify({ name: 'root-config' })
    )
    
    const config = await readDevcontainerJson(testDir)
    assert.strictEqual(config.name, 'root-config')
  })

  test('prefers .devcontainer/ over root', async () => {
    mkdirSync(join(testDir, '.devcontainer'), { recursive: true })
    writeFileSync(
      join(testDir, '.devcontainer', 'devcontainer.json'),
      JSON.stringify({ name: 'subdir-config' })
    )
    writeFileSync(
      join(testDir, '.devcontainer.json'),
      JSON.stringify({ name: 'root-config' })
    )
    
    const config = await readDevcontainerJson(testDir)
    assert.strictEqual(config.name, 'subdir-config')
  })

  test('returns null if no devcontainer config exists', async () => {
    const config = await readDevcontainerJson(testDir)
    assert.strictEqual(config, null)
  })
})

describe('detectInternalPort', () => {
  test('detects port from forwardPorts', () => {
    const config = { forwardPorts: [8080, 3000] }
    const port = detectInternalPort(config)
    assert.strictEqual(port, 8080)
  })

  test('detects port from runArgs -p flag', () => {
    const config = { runArgs: ['-p', '8000:3000'] }
    const port = detectInternalPort(config)
    assert.strictEqual(port, 3000)
  })

  test('detects port from runArgs HOST:PORT format', () => {
    const config = { runArgs: ['--other-flag', '5000:4000', '--another'] }
    const port = detectInternalPort(config)
    assert.strictEqual(port, 4000)
  })

  test('defaults to 3000 if no port found', () => {
    const config = {}
    const port = detectInternalPort(config)
    assert.strictEqual(port, 3000)
  })

  test('defaults to 3000 for null config', () => {
    const port = detectInternalPort(null)
    assert.strictEqual(port, 3000)
  })
})

describe('generateOverrideConfig', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-genoverride-' + Date.now())

  beforeEach(() => {
    process.env.OCDC_CACHE_DIR = join(testDir, 'cache')
    mkdirSync(join(testDir, 'workspace', '.devcontainer'), { recursive: true })
    mkdirSync(join(testDir, 'cache', 'overrides'), { recursive: true })
    writeFileSync(
      join(testDir, 'workspace', '.devcontainer', 'devcontainer.json'),
      JSON.stringify({
        name: 'original',
        forwardPorts: [3000],
        runArgs: ['-p', '3000:3000', '--some-flag'],
      })
    )
  })

  afterEach(() => {
    delete process.env.OCDC_CACHE_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('generates override config with port mapping', async () => {
    const workspace = join(testDir, 'workspace')
    const overridePath = await generateOverrideConfig(workspace, 13001)
    
    assert.ok(existsSync(overridePath))
    
    const override = JSON.parse(readFileSync(overridePath, 'utf-8'))
    assert.ok(override.runArgs.includes('-p'))
    assert.ok(override.runArgs.includes('13001:3000'))
  })

  test('removes existing port mappings from runArgs', async () => {
    const workspace = join(testDir, 'workspace')
    const overridePath = await generateOverrideConfig(workspace, 13002)
    
    const override = JSON.parse(readFileSync(overridePath, 'utf-8'))
    
    // Should not have the old port mapping
    assert.ok(!override.runArgs.some(a => a === '3000:3000'))
    // Should keep other flags
    assert.ok(override.runArgs.includes('--some-flag'))
  })

  test('sets container name with port', async () => {
    const workspace = join(testDir, 'workspace')
    const overridePath = await generateOverrideConfig(workspace, 13003)
    
    const override = JSON.parse(readFileSync(overridePath, 'utf-8'))
    assert.ok(override.name.includes('13003'))
  })

  test('sets correct workspaceFolder', async () => {
    const workspace = join(testDir, 'workspace')
    const overridePath = await generateOverrideConfig(workspace, 13004)
    
    const override = JSON.parse(readFileSync(overridePath, 'utf-8'))
    assert.strictEqual(override.workspaceFolder, '/workspaces/workspace')
  })

  test('handles config without runArgs', async () => {
    writeFileSync(
      join(testDir, 'workspace', '.devcontainer', 'devcontainer.json'),
      JSON.stringify({ name: 'minimal' })
    )
    
    const workspace = join(testDir, 'workspace')
    const overridePath = await generateOverrideConfig(workspace, 13005)
    
    const override = JSON.parse(readFileSync(overridePath, 'utf-8'))
    assert.ok(Array.isArray(override.runArgs))
    assert.ok(override.runArgs.includes('-p'))
  })
})

describe('loadUserConfig', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-userconfig-' + Date.now())

  beforeEach(() => {
    process.env.OCDC_CONFIG_DIR = testDir
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    delete process.env.OCDC_CONFIG_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('returns default config when file missing', async () => {
    const config = await loadUserConfig()
    assert.strictEqual(config.portRangeStart, 13000)
    assert.strictEqual(config.portRangeEnd, 13099)
  })

  test('loads user config from file', async () => {
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({ portRangeStart: 14000, portRangeEnd: 14099 })
    )
    
    const config = await loadUserConfig()
    assert.strictEqual(config.portRangeStart, 14000)
    assert.strictEqual(config.portRangeEnd, 14099)
  })

  test('merges user config with defaults', async () => {
    writeFileSync(
      join(testDir, 'config.json'),
      JSON.stringify({ portRangeStart: 15000 })
    )
    
    const config = await loadUserConfig()
    assert.strictEqual(config.portRangeStart, 15000)
    assert.strictEqual(config.portRangeEnd, 13099) // Default
  })
})
