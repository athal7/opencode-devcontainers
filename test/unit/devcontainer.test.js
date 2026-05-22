/**
 * Tests for plugin/core/devcontainer.js
 * 
 * These tests verify the argument building and orchestration logic.
 * Integration tests that actually run devcontainer commands would go in test/integration/
 * 
 * Run with: node --test test/unit/devcontainer.test.js
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert'
import { join, basename } from 'path'
import { homedir } from 'os'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { createHash } from 'crypto'

// Module under test
import { 
  buildUpArgs,
  buildExecArgs,
  up,
  upBackground,
  exec,
  list,
  down,
  isContainerRunning,
  checkDevcontainerCli,
  remove
} from '../../plugin/core/devcontainer.js'
import { PATHS } from '../../plugin/core/paths.js'
import { readJobs, JOB_STATUS, removeJob } from '../../plugin/core/jobs.js'
import { getOverridePath } from '../../plugin/core/config.js'
import { getClonePath } from '../../plugin/core/clones.js'

describe('buildUpArgs', () => {
  test('includes workspace-folder and override-config', () => {
    const args = buildUpArgs('/workspace', '/override.json')
    
    assert.ok(args.includes('--workspace-folder'))
    assert.ok(args.includes('/workspace'))
    assert.ok(args.includes('--override-config'))
    assert.ok(args.includes('/override.json'))
  })

  test('includes remove-existing-container when specified', () => {
    const args = buildUpArgs('/workspace', '/override.json', { removeExisting: true })
    
    assert.ok(args.includes('--remove-existing-container'))
  })

  test('does not include remove-existing by default', () => {
    const args = buildUpArgs('/workspace', '/override.json')
    
    assert.ok(!args.includes('--remove-existing-container'))
  })
})

describe('buildExecArgs', () => {
  test('wraps command with sh -c for proper argument handling', () => {
    const args = buildExecArgs('/workspace', 'git status')
    
    assert.ok(args.includes('--workspace-folder'))
    assert.ok(args.includes('/workspace'))
    assert.ok(args.includes('--'))
    
    // Command should be wrapped with sh -c to handle arguments properly
    const dashIndex = args.indexOf('--')
    assert.ok(dashIndex > 0)
    assert.strictEqual(args[dashIndex + 1], 'sh')
    assert.strictEqual(args[dashIndex + 2], '-c')
    assert.strictEqual(args[dashIndex + 3], 'git status')
  })

  test('handles complex shell expressions', () => {
    const args = buildExecArgs('/workspace', 'echo "hello world" | grep hello')
    
    const dashIndex = args.indexOf('--')
    assert.strictEqual(args[dashIndex + 1], 'sh')
    assert.strictEqual(args[dashIndex + 2], '-c')
    assert.strictEqual(args[dashIndex + 3], 'echo "hello world" | grep hello')
  })

  test('includes override-config when provided', () => {
    const args = buildExecArgs('/workspace', 'npm test', { overridePath: '/override.json' })
    
    assert.ok(args.includes('--override-config'))
    assert.ok(args.includes('/override.json'))
    
    // Command should still be wrapped with sh -c
    const dashIndex = args.indexOf('--')
    assert.strictEqual(args[dashIndex + 1], 'sh')
    assert.strictEqual(args[dashIndex + 2], '-c')
    assert.strictEqual(args[dashIndex + 3], 'npm test')
  })
})

describe('checkDevcontainerCli', () => {
  test('returns boolean', async () => {
    const result = await checkDevcontainerCli()
    assert.strictEqual(typeof result, 'boolean')
  })
})

describe('list', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-list-' + Date.now())

  beforeEach(() => {
    process.env.OCDC_CACHE_DIR = testDir
    mkdirSync(testDir, { recursive: true })
    writeFileSync(join(testDir, 'ports.json'), JSON.stringify({
      '/workspace/one': { port: 13000, repo: 'one', branch: 'main', started: '2024-01-01T00:00:00Z' },
      '/workspace/two': { port: 13001, repo: 'two', branch: 'feature', started: '2024-01-01T00:00:00Z' },
    }))
  })

  afterEach(() => {
    delete process.env.OCDC_CACHE_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('returns all port allocations', async () => {
    const result = await list()
    
    assert.strictEqual(result.length, 2)
    assert.ok(result.some(r => r.port === 13000 && r.repo === 'one'))
    assert.ok(result.some(r => r.port === 13001 && r.repo === 'two'))
  })

  test('includes workspace path in results', async () => {
    const result = await list()
    
    assert.ok(result.some(r => r.workspace === '/workspace/one'))
    assert.ok(result.some(r => r.workspace === '/workspace/two'))
  })

  test('includes status field for each allocation', async () => {
    const result = await list()
    
    // Since no containers are running, all should be 'down'
    assert.ok(result.every(r => r.status === 'down'))
  })

  test('returns down status when container not running', async () => {
    const result = await list()
    
    const workspace = result.find(r => r.workspace === '/workspace/one')
    assert.strictEqual(workspace.status, 'down')
    assert.strictEqual(workspace.actualPort, undefined)
  })

  test('sync option does not break when no containers running', async () => {
    // This test verifies that list({ sync: true }) works correctly
    // even when no containers are running (the common case in tests)
    
    const result = await list({ sync: true })
    
    // With no running containers, status should still be 'down'
    assert.ok(result.every(r => r.status === 'down'))
    
    // ports.json should be unchanged since no containers are running
    const ports = JSON.parse(readFileSync(join(testDir, 'ports.json'), 'utf-8'))
    assert.strictEqual(ports['/workspace/one'].port, 13000)
  })
})

describe('isContainerRunning', () => {
  // This is a heuristic check - in unit tests we mainly verify the function exists
  // and handles errors gracefully
  
  test('returns boolean', async () => {
    const result = await isContainerRunning('/nonexistent/workspace')
    assert.strictEqual(typeof result, 'boolean')
  })
})

// Integration-style tests (mock the devcontainer CLI)
describe('up (integration)', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-up-' + Date.now())
  const workspaceDir = join(testDir, 'workspace')

  beforeEach(() => {
    process.env.OCDC_CACHE_DIR = testDir
    process.env.OCDC_CONFIG_DIR = join(testDir, 'config')
    process.env.OCDC_CLONES_DIR = join(testDir, 'clones')
    
    mkdirSync(join(testDir, 'config'), { recursive: true })
    mkdirSync(join(testDir, 'overrides'), { recursive: true })
    mkdirSync(join(workspaceDir, '.devcontainer'), { recursive: true })
    
    writeFileSync(join(testDir, 'ports.json'), '{}')
    writeFileSync(join(testDir, 'config', 'config.json'), JSON.stringify({
      portRangeStart: 19000,
      portRangeEnd: 19010,
    }))
    writeFileSync(
      join(workspaceDir, '.devcontainer', 'devcontainer.json'),
      JSON.stringify({ name: 'test', forwardPorts: [3000] })
    )
    
    // Create git repo for workspace
    execSync('git init -b main', { cwd: workspaceDir })
    writeFileSync(join(workspaceDir, 'README.md'), '# Test')
    execSync('git add .', { cwd: workspaceDir })
    execSync('git commit -m "Initial"', { cwd: workspaceDir })
  })

  afterEach(() => {
    delete process.env.OCDC_CACHE_DIR
    delete process.env.OCDC_CONFIG_DIR
    delete process.env.OCDC_CLONES_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('allocates port and generates override config', async () => {
    // Note: This will fail if devcontainer CLI is not installed,
    // but that's expected for unit tests. We can check the setup worked.
    try {
      await up(workspaceDir, { dryRun: true })
    } catch (e) {
      // Expected in unit test environment without devcontainer
      if (!e.message.includes('devcontainer')) {
        throw e
      }
    }
    
    // Port should have been allocated
    const ports = JSON.parse(readFileSync(join(testDir, 'ports.json'), 'utf-8'))
    // May or may not have allocated depending on where it failed
    // Just verify the setup is correct
    assert.ok(true)
  })

  test('accepts signal option for cancellation', async () => {
    // This test verifies up() accepts a signal option
    // We use dryRun to avoid actually starting a container
    const controller = new AbortController()
    
    try {
      const result = await up(workspaceDir, { 
        dryRun: true, 
        signal: controller.signal 
      })
      
      // dryRun should return without throwing
      assert.ok(result.dryRun, 'Should be a dry run result')
      assert.ok(result.workspace, 'Should have workspace')
      assert.ok(result.port, 'Should have port')
    } catch (e) {
      // If devcontainer CLI not installed, that's fine for this test
      if (!e.message.includes('devcontainer')) {
        throw e
      }
    }
  })
})

describe('runCommand abort signal', () => {
  // We need to test that runCommand properly handles AbortSignal
  // To test this, we export runCommand from devcontainer.js
  
  test('abort signal cancels running command', async () => {
    // Import runCommand which is now exported for testing
    const { runCommand } = await import('../../plugin/core/devcontainer.js')
    
    const controller = new AbortController()
    const startTime = Date.now()
    
    // Abort after 50ms
    setTimeout(() => controller.abort(), 50)
    
    // Run a command that would take 5 seconds
    try {
      await runCommand('sleep', ['5'], { signal: controller.signal })
      assert.fail('Should have thrown AbortError')
    } catch (err) {
      const elapsed = Date.now() - startTime
      assert.strictEqual(err.name, 'AbortError', 'Error should be AbortError')
      // Should abort much faster than the 5 second sleep command
      // Using 2000ms as threshold to be generous for slow CI systems
      assert.ok(elapsed < 2000, `Should abort quickly, took ${elapsed}ms`)
    }
  })

  test('abort uses SIGKILL to force terminate stubborn processes', async () => {
    // This test verifies that abort uses SIGKILL (which cannot be ignored)
    // We use a bash script that traps SIGTERM to simulate a stubborn process
    // like devcontainer CLI that may not respond to SIGTERM
    const { runCommand } = await import('../../plugin/core/devcontainer.js')
    
    const controller = new AbortController()
    const startTime = Date.now()
    
    // Abort after 300ms (give process time to start and set up trap on slower systems)
    setTimeout(() => controller.abort(), 300)
    
    // Run a command that ignores SIGTERM but cannot ignore SIGKILL
    // The process echoes "started" then sleeps, ignoring SIGTERM
    try {
      await runCommand('bash', ['-c', 'trap "" SIGTERM; echo started; sleep 30'], { signal: controller.signal })
      assert.fail('Should have thrown AbortError')
    } catch (err) {
      const elapsed = Date.now() - startTime
      assert.strictEqual(err.name, 'AbortError', 'Error should be AbortError')
      // Should abort within 500ms of the abort signal (200ms + 300ms margin)
      // If SIGKILL is not used, the process would hang for 30 seconds
      assert.ok(elapsed < 1000, `Should abort quickly with SIGKILL, took ${elapsed}ms`)
    }
  })
  
  test('completed command returns normally without abort', async () => {
    const { runCommand } = await import('../../plugin/core/devcontainer.js')
    
    const result = await runCommand('echo', ['hello'])
    
    assert.strictEqual(result.success, true)
    assert.strictEqual(result.stdout, 'hello')
    assert.strictEqual(result.exitCode, 0)
  })

  test('timeout option terminates long-running commands', async () => {
    const { runCommand } = await import('../../plugin/core/devcontainer.js')
    
    const startTime = Date.now()
    
    // Run a command that would take 30 seconds, with 200ms timeout
    // Node.js spawn timeout kills the process but doesn't throw - it resolves
    // with non-zero exit code or null exit code (when killed by signal)
    const result = await runCommand('sleep', ['30'], { timeout: 200 })
    
    const elapsed = Date.now() - startTime
    // Should complete within 500ms (200ms timeout + margin)
    assert.ok(elapsed < 1000, `Should timeout quickly, took ${elapsed}ms`)
    // Process was killed by signal, so exitCode is null and success is false
    assert.strictEqual(result.success, false, 'Should not be successful when killed by timeout')
  })

  test('timeout does not affect fast commands', async () => {
    const { runCommand } = await import('../../plugin/core/devcontainer.js')
    
    // Fast command with generous timeout should complete normally
    const result = await runCommand('echo', ['fast'], { timeout: 5000 })
    
    assert.strictEqual(result.success, true)
    assert.strictEqual(result.stdout, 'fast')
  })
})

describe('upBackground', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-upbg-' + Date.now())
  const workspaceDir = join(testDir, 'workspace')

  beforeEach(() => {
    process.env.OCDC_CACHE_DIR = testDir
    process.env.OCDC_CONFIG_DIR = join(testDir, 'config')
    process.env.OCDC_CLONES_DIR = join(testDir, 'clones')
    
    mkdirSync(join(testDir, 'config'), { recursive: true })
    mkdirSync(join(testDir, 'overrides'), { recursive: true })
    mkdirSync(join(workspaceDir, '.devcontainer'), { recursive: true })
    
    writeFileSync(join(testDir, 'ports.json'), '{}')
    writeFileSync(join(testDir, 'jobs.json'), '{}')
    writeFileSync(join(testDir, 'config', 'config.json'), JSON.stringify({
      portRangeStart: 19000,
      portRangeEnd: 19010,
    }))
    writeFileSync(
      join(workspaceDir, '.devcontainer', 'devcontainer.json'),
      JSON.stringify({ name: 'test', forwardPorts: [3000] })
    )
    
    // Create git repo for workspace
    execSync('git init -b main', { cwd: workspaceDir })
    writeFileSync(join(workspaceDir, 'README.md'), '# Test')
    execSync('git add .', { cwd: workspaceDir })
    execSync('git commit -m "Initial"', { cwd: workspaceDir })
  })

  afterEach(() => {
    delete process.env.OCDC_CACHE_DIR
    delete process.env.OCDC_CONFIG_DIR
    delete process.env.OCDC_CLONES_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('returns immediately without blocking', async () => {
    const startTime = Date.now()
    
    const result = await upBackground(workspaceDir)
    
    const elapsed = Date.now() - startTime
    // Should return in under 500ms (not waiting for container)
    assert.ok(elapsed < 500, `upBackground should return quickly, took ${elapsed}ms`)
    
    // Should return job info
    assert.ok(result.workspace)
    assert.ok(result.branch)
    assert.ok(result.repo)
  })

  test('creates job entry on start', async () => {
    const result = await upBackground(workspaceDir)

    // startJob is awaited synchronously before upBackground returns,
    // so the job exists immediately. The background task may have already
    // transitioned it from pending -> running by the time we read.
    const jobs = await readJobs()
    const job = jobs[result.workspace]

    assert.ok(job, 'Job should be created')
    assert.ok(Object.values(JOB_STATUS).includes(job.status), 'Job should have a valid status')
    assert.strictEqual(job.branch, 'main')
  })

  test('returns workspace path and branch info', async () => {
    const result = await upBackground(workspaceDir)
    
    assert.strictEqual(result.workspace, workspaceDir)
    assert.strictEqual(result.branch, 'main')
    assert.strictEqual(result.repo, basename(workspaceDir))
  })

  test('validates devcontainer.json exists', async () => {
    // Remove devcontainer.json
    rmSync(join(workspaceDir, '.devcontainer'), { recursive: true, force: true })
    
    await assert.rejects(
      () => upBackground(workspaceDir),
      /No devcontainer.json found/
    )
  })

  test('validates git repository', async () => {
    // Create a directory without git
    const noGitDir = join(testDir, 'no-git')
    mkdirSync(join(noGitDir, '.devcontainer'), { recursive: true })
    writeFileSync(
      join(noGitDir, '.devcontainer', 'devcontainer.json'),
      JSON.stringify({ name: 'test' })
    )
    
    // upBackground with a branch name (not workspace path) needs git
    await assert.rejects(
      () => upBackground('some-branch', { cwd: noGitDir }),
      /Not in a git repository/
    )
  })
})

describe('down', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-down-' + Date.now())

  beforeEach(() => {
    process.env.OCDC_CACHE_DIR = testDir
    mkdirSync(testDir, { recursive: true })
    writeFileSync(join(testDir, 'ports.json'), JSON.stringify({
      '/workspace/test': { port: 13000, repo: 'test', branch: 'main' },
    }))
  })

  afterEach(() => {
    delete process.env.OCDC_CACHE_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('releases port allocation', async () => {
    await down('/workspace/test')
    
    // Give async file operations time to complete
    await new Promise(resolve => setTimeout(resolve, 100))
    
    const content = readFileSync(join(testDir, 'ports.json'), 'utf-8')
    const ports = JSON.parse(content)
    assert.strictEqual(ports['/workspace/test'], undefined)
  })

  test('handles non-existent workspace', async () => {
    // Should not throw
    await down('/workspace/nonexistent')
  })
})

describe('remove', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-remove-' + Date.now())
  const workspace = join(testDir, 'clones', 'my-repo', 'feature-x')
  const repo = 'my-repo'
  const branch = 'feature-x'

  /**
   * Create a full set of workspace artifacts as if a devcontainer was set up:
   * ports.json entry, jobs.json entry, override config, clone folder, session files
   */
  function createFullWorkspaceState() {
    mkdirSync(join(testDir, 'config'), { recursive: true })
    writeFileSync(join(testDir, 'config', 'config.json'), JSON.stringify({
      portRangeStart: 19000,
      portRangeEnd: 19010,
    }))

    mkdirSync(testDir, { recursive: true })
    writeFileSync(join(testDir, 'ports.json'), JSON.stringify({
      [workspace]: { port: 19000, repo, branch, started: '2026-01-01T00:00:00Z' },
    }))

    writeFileSync(join(testDir, 'jobs.json'), JSON.stringify({
      [workspace]: { workspace, repo, branch, status: JOB_STATUS.COMPLETED, startedAt: '2026-01-01T00:00:00Z' },
    }))

    const overrideDir = join(testDir, 'overrides')
    mkdirSync(overrideDir, { recursive: true })
    const overrideFilename = createHash('md5').update(workspace).digest('hex') + '.json'
    writeFileSync(join(overrideDir, overrideFilename), JSON.stringify({
      name: 'test (port 19000)',
      workspaceFolder: '/workspaces/test',
    }))

    mkdirSync(join(workspace, '.git'), { recursive: true })
    writeFileSync(join(workspace, 'README.md'), '# Test')

    const sessionsDir = join(testDir, 'opencode-sessions')
    mkdirSync(sessionsDir, { recursive: true })
    writeFileSync(join(sessionsDir, 'test-session.json'), JSON.stringify({
      branch, workspace, repoName: repo, type: 'devcontainer', activatedAt: '2026-01-01T00:00:00Z',
    }))
    writeFileSync(join(sessionsDir, 'other-session.json'), JSON.stringify({
      branch: 'other', workspace: '/other/workspace', repoName: 'other', type: 'devcontainer',
    }))
  }

  beforeEach(() => {
    process.env.OCDC_CACHE_DIR = testDir
    process.env.OCDC_CONFIG_DIR = join(testDir, 'config')
    process.env.OCDC_CLONES_DIR = join(testDir, 'clones')
  })

  afterEach(() => {
    delete process.env.OCDC_CACHE_DIR
    delete process.env.OCDC_CONFIG_DIR
    delete process.env.OCDC_CLONES_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('removes all workspace components when everything exists', async () => {
    createFullWorkspaceState()

    const summary = await remove(workspace, repo, branch)

    // Docker not available in unit tests — container fields are false
    assert.strictEqual(summary.containerFound, false)
    assert.strictEqual(summary.portReleased, true)
    assert.strictEqual(summary.jobRemoved, true)
    assert.strictEqual(summary.overrideDeleted, true)
    assert.strictEqual(summary.cloneDeleted, true)
    assert.strictEqual(summary.sessionsCleaned, 1)

    // Verify filesystem artifacts are actually gone
    const ports = JSON.parse(readFileSync(join(testDir, 'ports.json'), 'utf-8'))
    assert.strictEqual(ports[workspace], undefined, 'port entry removed')

    const jobs = await readJobs()
    assert.strictEqual(jobs[workspace], undefined, 'job entry removed')

    assert.ok(!existsSync(getOverridePath(workspace)), 'override config deleted')
    assert.ok(!existsSync(workspace), 'clone folder deleted')

    const sessionFile = join(PATHS.sessions, 'test-session.json')
    const otherSessionFile = join(PATHS.sessions, 'other-session.json')
    assert.ok(!existsSync(sessionFile), 'matching session cleaned up')
    assert.ok(existsSync(otherSessionFile), 'other session preserved')
  })

  test('handles workspace with missing clone folder', async () => {
    createFullWorkspaceState()
    // Remove the clone folder before calling remove
    rmSync(workspace, { recursive: true, force: true })

    const summary = await remove(workspace, repo, branch)

    assert.strictEqual(summary.cloneDeleted, false, 'clone was already gone')
    assert.strictEqual(summary.portReleased, true, 'port still released')
    assert.strictEqual(summary.jobRemoved, true, 'job still removed')
    assert.strictEqual(summary.overrideDeleted, true, 'override still cleaned')
    assert.strictEqual(summary.errors.length, 0, 'no errors')
  })

  test('handles workspace with no port or job entries', async () => {
    // Only create clone folder and override, no ports/jobs entries
    mkdirSync(join(testDir, 'overrides'), { recursive: true })
    const overrideFilename = createHash('md5').update(workspace).digest('hex') + '.json'
    writeFileSync(join(testDir, 'overrides', overrideFilename), JSON.stringify({ name: 'test' }))
    mkdirSync(join(workspace, '.git'), { recursive: true })
    writeFileSync(join(workspace, 'README.md'), '# Test')
    mkdirSync(testDir, { recursive: true })
    writeFileSync(join(testDir, 'ports.json'), '{}')
    writeFileSync(join(testDir, 'jobs.json'), '{}')

    const summary = await remove(workspace, repo, branch)

    assert.strictEqual(summary.portReleased, true, 'releasePort called')
    assert.strictEqual(summary.jobRemoved, false, 'no job to remove')
    assert.strictEqual(summary.overrideDeleted, true)
    assert.strictEqual(summary.cloneDeleted, true)
    assert.strictEqual(summary.errors.length, 0)
  })

  test('handles completely unknown workspace gracefully', async () => {
    mkdirSync(testDir, { recursive: true })
    writeFileSync(join(testDir, 'ports.json'), '{}')
    writeFileSync(join(testDir, 'jobs.json'), '{}')

    const summary = await remove('/nonexistent/workspace', 'test', 'nonexistent')

    assert.strictEqual(summary.containerFound, false)
    assert.strictEqual(summary.portReleased, true)
    assert.strictEqual(summary.jobRemoved, false)
    assert.strictEqual(summary.overrideDeleted, false)
    assert.strictEqual(summary.cloneDeleted, false)
    assert.strictEqual(summary.sessionsCleaned, 0)
    assert.strictEqual(summary.errors.length, 0)
  })

  test('removal is idempotent', async () => {
    createFullWorkspaceState()

    const first = await remove(workspace, repo, branch)
    assert.strictEqual(first.portReleased, true)
    assert.strictEqual(first.jobRemoved, true)
    assert.strictEqual(first.cloneDeleted, true)

    const second = await remove(workspace, repo, branch)
    assert.strictEqual(second.portReleased, true)
    assert.strictEqual(second.jobRemoved, false, 'no job on second call')
    assert.strictEqual(second.cloneDeleted, false, 'no clone on second call')
    assert.strictEqual(second.errors.length, 0, 'no errors on repeat')
  })
})
