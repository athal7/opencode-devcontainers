/**
 * Tests for plugin/helpers.js
 * 
 * Run with: node --test test/unit/helpers.test.js
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { tmpdir } from 'os'

import {
  withTimeout,
  runWithTimeout,
  getCacheDir,
  getSessionsDir,
  getClonesDir,
  HOST_COMMANDS,
  loadSession,
  saveSession,
  deleteSession,
  resolveWorkspace,
  shouldRunOnHost,
  shellQuote,
} from '../../plugin/helpers.js'

// Test directory setup
let testDir
let originalEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  testDir = join(tmpdir(), `ocdc-helpers-test-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })
  
  process.env.HOME = join(testDir, 'home')
  process.env.OCDC_CACHE_DIR = join(testDir, 'cache')
  process.env.OCDC_CLONES_DIR = join(testDir, 'clones')
  process.env.OCDC_SESSIONS_DIR = join(testDir, 'sessions')
  
  mkdirSync(process.env.HOME, { recursive: true })
  mkdirSync(process.env.OCDC_CACHE_DIR, { recursive: true })
  mkdirSync(process.env.OCDC_CLONES_DIR, { recursive: true })
  mkdirSync(process.env.OCDC_SESSIONS_DIR, { recursive: true })
})

afterEach(() => {
  process.env = originalEnv
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true })
  }
})

// ============ Utility Functions Tests ============

describe('withTimeout', () => {
  test('resolves fast promise', async () => {
    const result = await withTimeout(Promise.resolve('fast'), 1000)
    assert.strictEqual(result, 'fast')
  })

  test('rejects slow promise', async () => {
    const slowPromise = new Promise(resolve => setTimeout(() => resolve('slow'), 200))
    await assert.rejects(
      () => withTimeout(slowPromise, 50),
      { message: 'TIMEOUT' }
    )
  })
})

describe('runWithTimeout', () => {
  test('returns value on success', async () => {
    const result = await runWithTimeout(async () => 'success', 1000)
    assert.strictEqual(result, 'success')
  })

  test('returns undefined on timeout', async () => {
    const result = await runWithTimeout(
      () => new Promise(resolve => setTimeout(() => resolve('slow'), 200)),
      50
    )
    assert.strictEqual(result, undefined)
  })

  test('returns undefined on error', async () => {
    const result = await runWithTimeout(async () => { throw new Error('oops') }, 1000)
    assert.strictEqual(result, undefined)
  })
})

// ============ Directory Getters Tests ============

describe('getCacheDir', () => {
  test('uses env var when set', () => {
    assert.strictEqual(getCacheDir(), process.env.OCDC_CACHE_DIR)
  })
})

describe('getSessionsDir', () => {
  test('uses env var when set', () => {
    assert.strictEqual(getSessionsDir(), process.env.OCDC_SESSIONS_DIR)
  })
})

describe('getClonesDir', () => {
  test('uses env var when set', () => {
    assert.strictEqual(getClonesDir(), process.env.OCDC_CLONES_DIR)
  })
})

// ============ HOST_COMMANDS Tests ============

describe('HOST_COMMANDS', () => {
  test('is a non-empty array', () => {
    assert.ok(Array.isArray(HOST_COMMANDS))
    assert.ok(HOST_COMMANDS.length > 0)
  })

  test('includes git', () => {
    assert.ok(HOST_COMMANDS.includes('git'))
  })

  test('includes file reading commands', () => {
    const fileCommands = ['cat', 'head', 'tail', 'grep', 'ls']
    for (const cmd of fileCommands) {
      assert.ok(HOST_COMMANDS.includes(cmd), `Should include ${cmd}`)
    }
  })

  test('includes devcontainer to prevent recursion', () => {
    assert.ok(HOST_COMMANDS.includes('devcontainer'))
  })

  test('excludes dev tools (should run in container)', () => {
    const devTools = ['npm', 'yarn', 'pnpm', 'bundle', 'rails', 'python', 'pip', 'cargo', 'make']
    for (const cmd of devTools) {
      assert.ok(!HOST_COMMANDS.includes(cmd), `Should NOT include ${cmd}`)
    }
  })
})

// ============ Session Management Tests ============

describe('loadSession', () => {
  test('returns null for non-existent session', () => {
    const result = loadSession('nonexistent-session-id')
    assert.strictEqual(result, null)
  })

  test('returns session data for existing session', () => {
    const sessionId = 'test-session-123'
    const sessionData = { branch: 'main', workspace: '/test', repoName: 'myrepo' }
    saveSession(sessionId, sessionData)
    
    const result = loadSession(sessionId)
    assert.strictEqual(result.branch, 'main')
    assert.strictEqual(result.workspace, '/test')
    assert.strictEqual(result.repoName, 'myrepo')
    assert.ok(result.activatedAt) // Should have timestamp
  })
})

describe('saveSession', () => {
  test('creates session file', () => {
    const sessionId = 'save-test-session'
    saveSession(sessionId, { branch: 'feature' })
    
    const result = loadSession(sessionId)
    assert.strictEqual(result.branch, 'feature')
  })

  test('adds activatedAt timestamp', () => {
    const sessionId = 'timestamp-test'
    saveSession(sessionId, { branch: 'main' })
    
    const result = loadSession(sessionId)
    assert.ok(result.activatedAt)
    assert.ok(new Date(result.activatedAt).getTime() > 0)
  })
})

describe('deleteSession', () => {
  test('removes session file', () => {
    const sessionId = 'delete-test'
    saveSession(sessionId, { branch: 'main' })
    assert.ok(loadSession(sessionId)) // Exists
    
    deleteSession(sessionId)
    assert.strictEqual(loadSession(sessionId), null) // Gone
  })

  test('handles non-existent session gracefully', () => {
    // Should not throw
    deleteSession('nonexistent-session')
  })
})

// ============ Workspace Resolution Tests ============

describe('resolveWorkspace', () => {
  test('resolves repo/branch syntax', () => {
    const clonePath = join(process.env.OCDC_CLONES_DIR, 'myrepo', 'feature-branch')
    mkdirSync(clonePath, { recursive: true })
    
    const result = resolveWorkspace('myrepo/feature-branch')
    assert.strictEqual(result.workspace, clonePath)
    assert.strictEqual(result.repoName, 'myrepo')
    assert.strictEqual(result.branch, 'feature-branch')
  })

  test('handles nested branch names with slashes', () => {
    const clonePath = join(process.env.OCDC_CLONES_DIR, 'myrepo', 'feature/sub/branch')
    mkdirSync(clonePath, { recursive: true })
    
    const result = resolveWorkspace('myrepo/feature/sub/branch')
    assert.strictEqual(result.branch, 'feature/sub/branch')
  })

  test('returns null for non-existent workspace', () => {
    const result = resolveWorkspace('nonexistent-repo/nonexistent-branch')
    assert.strictEqual(result, null)
  })

  test('returns ambiguous when branch exists in multiple repos', () => {
    // Create same branch in two repos
    mkdirSync(join(process.env.OCDC_CLONES_DIR, 'repo1', 'shared-branch'), { recursive: true })
    mkdirSync(join(process.env.OCDC_CLONES_DIR, 'repo2', 'shared-branch'), { recursive: true })
    
    const result = resolveWorkspace('shared-branch')
    assert.strictEqual(result.ambiguous, true)
    assert.strictEqual(result.matches.length, 2)
  })
})

// ============ shouldRunOnHost Tests ============

describe('shouldRunOnHost', () => {
  test('returns true for git commands', () => {
    const gitCommands = ['git status', 'git push', 'git log --oneline', 'git diff HEAD~1']
    for (const cmd of gitCommands) {
      assert.ok(shouldRunOnHost(cmd), `${cmd} should run on host`)
    }
  })

  test('returns true for file reading commands', () => {
    const fileCommands = ['cat file.txt', 'head -n 10 file.txt', 'tail -f log.txt', 'grep pattern file']
    for (const cmd of fileCommands) {
      assert.ok(shouldRunOnHost(cmd), `${cmd} should run on host`)
    }
  })

  test('returns false for dev commands', () => {
    const devCommands = ['npm install', 'yarn test', 'python script.py', 'make build']
    for (const cmd of devCommands) {
      assert.ok(!shouldRunOnHost(cmd), `${cmd} should run in container`)
    }
  })

  test('returns "escape" for HOST: prefix', () => {
    assert.strictEqual(shouldRunOnHost('HOST: npm install'), 'escape')
    assert.strictEqual(shouldRunOnHost('host: npm install'), 'escape')
    assert.strictEqual(shouldRunOnHost('HOST:npm install'), 'escape')
  })

  test('returns true for empty commands', () => {
    assert.ok(shouldRunOnHost(''))
    assert.ok(shouldRunOnHost('   '))
    assert.ok(shouldRunOnHost(null))
    assert.ok(shouldRunOnHost(undefined))
  })
})

// ============ shellQuote Tests ============

describe('shellQuote', () => {
  test('returns safe strings unchanged', () => {
    assert.strictEqual(shellQuote('simple'), 'simple')
    assert.strictEqual(shellQuote('path/to/file'), 'path/to/file')
    assert.strictEqual(shellQuote('file.txt'), 'file.txt')
    assert.strictEqual(shellQuote('key=value'), 'key=value')
  })

  test('quotes strings with spaces', () => {
    assert.strictEqual(shellQuote('hello world'), "'hello world'")
    assert.strictEqual(shellQuote('path with spaces'), "'path with spaces'")
  })

  test('escapes single quotes', () => {
    const result = shellQuote("it's")
    // Should be: 'it'"'"'s'
    assert.ok(result.includes("'\"'\"'"), `Expected escaped quotes in: ${result}`)
  })

  test('quotes special shell characters', () => {
    assert.strictEqual(shellQuote('$HOME'), "'$HOME'")
    assert.strictEqual(shellQuote('`whoami`'), "'`whoami`'")
    assert.strictEqual(shellQuote('a && b'), "'a && b'")
    assert.strictEqual(shellQuote('a | b'), "'a | b'")
  })

  test('quotes empty string', () => {
    assert.strictEqual(shellQuote(''), "''")
  })

  test('prevents command injection', () => {
    const malicious = '$(rm -rf /)'
    const quoted = shellQuote(malicious)
    // Quoted string should not allow execution
    assert.ok(quoted.startsWith("'"))
    assert.ok(quoted.endsWith("'"))
  })

  test('handles newlines', () => {
    const withNewline = "line1\nline2"
    const quoted = shellQuote(withNewline)
    assert.ok(quoted.startsWith("'"))
    assert.ok(quoted.includes('\n'))
  })
})
