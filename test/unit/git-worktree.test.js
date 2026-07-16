/**
 * Tests for git worktree operations in plugin/core/git.js
 * 
 * Run with: node --test test/unit/git-worktree.test.js
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { execSync } from 'child_process'

// Module under test
import { 
  createWorktree,
  removeWorktree,
  listWorktrees,
  isWorktree,
  getWorktreeMainRepo,
} from '../../plugin/core/git.js'

describe('isWorktree', () => {
  const testDir = join(homedir(), '.cache/ocw-test-isworktree-' + Date.now())
  const mainRepo = join(testDir, 'main')
  const worktreePath = join(testDir, 'worktree')

  beforeEach(() => {
    mkdirSync(mainRepo, { recursive: true })
    
    // Create main repo with initial commit
    execSync('git init -b main', { cwd: mainRepo })
    writeFileSync(join(mainRepo, 'README.md'), '# Test')
    execSync('git add .', { cwd: mainRepo })
    execSync('git commit -m "Initial commit"', { cwd: mainRepo })
    
    // Create a worktree
    execSync(`git worktree add ${worktreePath} -b feature`, { cwd: mainRepo })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('returns true for a worktree directory', async () => {
    const result = await isWorktree(worktreePath)
    assert.strictEqual(result, true)
  })

  test('returns false for main repo', async () => {
    const result = await isWorktree(mainRepo)
    assert.strictEqual(result, false)
  })

  test('returns false for non-git directory', async () => {
    const nonGitDir = join(testDir, 'nongit')
    mkdirSync(nonGitDir, { recursive: true })
    const result = await isWorktree(nonGitDir)
    assert.strictEqual(result, false)
  })

  test('returns false for non-existent directory', async () => {
    const result = await isWorktree('/nonexistent/path')
    assert.strictEqual(result, false)
  })

  test('returns false for a submodule directory', async () => {
    const subRepo = join(testDir, 'sub-repo')
    const submodulePath = join(mainRepo, 'sub')

    mkdirSync(subRepo, { recursive: true })
    execSync('git init -b main', { cwd: subRepo })
    writeFileSync(join(subRepo, 'sub.txt'), 'sub')
    execSync('git add .', { cwd: subRepo })
    execSync('git commit -m "sub commit"', { cwd: subRepo })

    // Add submodule to main repo
    execSync('git config --global protocol.file.allow always', { cwd: mainRepo })
    execSync(`git submodule add ${subRepo} sub`, { cwd: mainRepo })
    execSync('git commit -m "add submodule"', { cwd: mainRepo })

    const result = await isWorktree(submodulePath)
    assert.strictEqual(result, false)
  })
})

describe('getWorktreeMainRepo', () => {
  const testDir = join(homedir(), '.cache/ocw-test-mainrepo-' + Date.now())
  const mainRepo = join(testDir, 'main')
  const worktreePath = join(testDir, 'worktree')

  beforeEach(() => {
    mkdirSync(mainRepo, { recursive: true })
    
    execSync('git init -b main', { cwd: mainRepo })
    writeFileSync(join(mainRepo, 'README.md'), '# Test')
    execSync('git add .', { cwd: mainRepo })
    execSync('git commit -m "Initial commit"', { cwd: mainRepo })
    
    execSync(`git worktree add ${worktreePath} -b feature`, { cwd: mainRepo })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('returns main repo path from worktree', async () => {
    const result = await getWorktreeMainRepo(worktreePath)
    assert.strictEqual(result, mainRepo)
  })

  test('returns null for main repo (not a worktree)', async () => {
    const result = await getWorktreeMainRepo(mainRepo)
    assert.strictEqual(result, null)
  })

  test('returns null for non-git directory', async () => {
    const nonGitDir = join(testDir, 'nongit')
    mkdirSync(nonGitDir, { recursive: true })
    const result = await getWorktreeMainRepo(nonGitDir)
    assert.strictEqual(result, null)
  })
})

describe('createWorktree', () => {
  const testDir = join(homedir(), '.cache/ocw-test-createwt-' + Date.now())
  const mainRepo = join(testDir, 'main')

  beforeEach(() => {
    mkdirSync(mainRepo, { recursive: true })
    
    execSync('git init -b main', { cwd: mainRepo })
    writeFileSync(join(mainRepo, 'README.md'), '# Test')
    execSync('git add .', { cwd: mainRepo })
    execSync('git commit -m "Initial commit"', { cwd: mainRepo })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('creates worktree with new branch', async () => {
    const worktreePath = join(testDir, 'feature-worktree')
    
    await createWorktree(mainRepo, 'feature-x', worktreePath)
    
    assert.ok(existsSync(worktreePath))
    assert.ok(existsSync(join(worktreePath, '.git')))
    assert.ok(existsSync(join(worktreePath, 'README.md')))
    
    // Verify it's a worktree (has .git file, not directory)
    const gitPath = join(worktreePath, '.git')
    const stat = await import('fs/promises').then(fs => fs.stat(gitPath))
    assert.ok(stat.isFile(), '.git should be a file in worktree')
  })

  test('creates worktree for existing branch', async () => {
    // Create branch in main repo first
    execSync('git branch existing-branch', { cwd: mainRepo })
    
    const worktreePath = join(testDir, 'existing-worktree')
    
    await createWorktree(mainRepo, 'existing-branch', worktreePath, { createBranch: false })
    
    assert.ok(existsSync(worktreePath))
  })

  test('throws error for invalid main repo', async () => {
    const nonGitDir = join(testDir, 'nongit')
    mkdirSync(nonGitDir, { recursive: true })
    
    await assert.rejects(
      () => createWorktree(nonGitDir, 'feature', join(testDir, 'wt')),
      /not a git repository|fatal/i
    )
  })

  test('throws error if worktree path already exists', async () => {
    const worktreePath = join(testDir, 'existing-path')
    mkdirSync(worktreePath, { recursive: true })
    writeFileSync(join(worktreePath, 'file.txt'), 'exists')
    
    await assert.rejects(
      () => createWorktree(mainRepo, 'feature', worktreePath),
      /already exists|fatal/i
    )
  })
})

describe('removeWorktree', () => {
  const testDir = join(homedir(), '.cache/ocw-test-removewt-' + Date.now())
  const mainRepo = join(testDir, 'main')
  const worktreePath = join(testDir, 'worktree')

  beforeEach(() => {
    mkdirSync(mainRepo, { recursive: true })
    
    execSync('git init -b main', { cwd: mainRepo })
    writeFileSync(join(mainRepo, 'README.md'), '# Test')
    execSync('git add .', { cwd: mainRepo })
    execSync('git commit -m "Initial commit"', { cwd: mainRepo })
    
    execSync(`git worktree add ${worktreePath} -b feature`, { cwd: mainRepo })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('removes worktree successfully', async () => {
    assert.ok(existsSync(worktreePath))
    
    await removeWorktree(mainRepo, worktreePath)
    
    assert.ok(!existsSync(worktreePath))
  })

  test('removes worktree with force option when dirty', async () => {
    // Make worktree dirty
    writeFileSync(join(worktreePath, 'uncommitted.txt'), 'dirty')
    
    await removeWorktree(mainRepo, worktreePath, { force: true })
    
    assert.ok(!existsSync(worktreePath))
  })

  test('throws error for non-existent worktree', async () => {
    await assert.rejects(
      () => removeWorktree(mainRepo, '/nonexistent/worktree'),
      /not a working tree|fatal/i
    )
  })
})

describe('listWorktrees', () => {
  const testDir = join(homedir(), '.cache/ocw-test-listwt-' + Date.now())
  const mainRepo = join(testDir, 'main')

  beforeEach(() => {
    mkdirSync(mainRepo, { recursive: true })
    
    execSync('git init -b main', { cwd: mainRepo })
    writeFileSync(join(mainRepo, 'README.md'), '# Test')
    execSync('git add .', { cwd: mainRepo })
    execSync('git commit -m "Initial commit"', { cwd: mainRepo })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('lists main repo as worktree', async () => {
    const worktrees = await listWorktrees(mainRepo)
    
    assert.strictEqual(worktrees.length, 1)
    assert.strictEqual(worktrees[0].path, mainRepo)
    assert.strictEqual(worktrees[0].branch, 'main')
    assert.strictEqual(worktrees[0].isMain, true)
  })

  test('lists all worktrees including created ones', async () => {
    const wt1 = join(testDir, 'wt-feature')
    const wt2 = join(testDir, 'wt-bugfix')
    
    execSync(`git worktree add ${wt1} -b feature`, { cwd: mainRepo })
    execSync(`git worktree add ${wt2} -b bugfix`, { cwd: mainRepo })
    
    const worktrees = await listWorktrees(mainRepo)
    
    assert.strictEqual(worktrees.length, 3)
    assert.ok(worktrees.some(wt => wt.path === mainRepo && wt.isMain))
    assert.ok(worktrees.some(wt => wt.path === wt1 && wt.branch === 'feature'))
    assert.ok(worktrees.some(wt => wt.path === wt2 && wt.branch === 'bugfix'))
  })

  test('returns empty array for non-git directory', async () => {
    const nonGitDir = join(testDir, 'nongit')
    mkdirSync(nonGitDir, { recursive: true })
    
    const worktrees = await listWorktrees(nonGitDir)
    assert.deepStrictEqual(worktrees, [])
  })
})
