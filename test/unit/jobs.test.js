/**
 * Tests for plugin/core/jobs.js
 * 
 * Run with: node --test test/unit/jobs.test.js
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'

// Module under test
import { 
  readJobs, 
  writeJobs, 
  startJob,
  updateJob,
  getJob,
  cleanupJobs,
  JOB_STATUS,
} from '../../plugin/core/jobs.js'

describe('readJobs / writeJobs', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-jobs-' + Date.now())
  
  beforeEach(() => {
    process.env.OCDC_CACHE_DIR = testDir
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    delete process.env.OCDC_CACHE_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('reads empty when file does not exist', async () => {
    const jobs = await readJobs()
    assert.deepStrictEqual(jobs, {})
  })

  test('reads existing jobs', async () => {
    const data = {
      '/workspace/one': { 
        status: 'running', 
        repo: 'one', 
        branch: 'main',
        startedAt: '2024-01-01T00:00:00Z'
      }
    }
    writeFileSync(join(testDir, 'jobs.json'), JSON.stringify(data))
    
    const jobs = await readJobs()
    assert.deepStrictEqual(jobs, data)
  })

  test('writes jobs atomically', async () => {
    const data = {
      '/workspace/test': { 
        status: 'pending', 
        repo: 'test', 
        branch: 'feature',
        startedAt: '2024-01-01T00:00:00Z'
      }
    }
    await writeJobs(data)
    
    const content = readFileSync(join(testDir, 'jobs.json'), 'utf-8')
    assert.deepStrictEqual(JSON.parse(content), data)
  })

  test('handles corrupted jobs file', async () => {
    writeFileSync(join(testDir, 'jobs.json'), 'not json')
    
    const jobs = await readJobs()
    assert.deepStrictEqual(jobs, {})
  })
})

describe('startJob', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-startjob-' + Date.now())
  
  beforeEach(() => {
    process.env.OCDC_CACHE_DIR = testDir
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    delete process.env.OCDC_CACHE_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('creates new job with pending status', async () => {
    const job = await startJob('/workspace/test', 'test-repo', 'main')
    
    assert.strictEqual(job.workspace, '/workspace/test')
    assert.strictEqual(job.repo, 'test-repo')
    assert.strictEqual(job.branch, 'main')
    assert.strictEqual(job.status, JOB_STATUS.PENDING)
    assert.ok(job.startedAt)
  })

  test('job is persisted to file', async () => {
    await startJob('/workspace/test', 'repo', 'main')
    
    const jobs = await readJobs()
    assert.ok(jobs['/workspace/test'])
    assert.strictEqual(jobs['/workspace/test'].status, JOB_STATUS.PENDING)
  })

  test('replaces existing job for same workspace', async () => {
    await startJob('/workspace/test', 'repo', 'old-branch')
    const job = await startJob('/workspace/test', 'repo', 'new-branch')
    
    assert.strictEqual(job.branch, 'new-branch')
    
    const jobs = await readJobs()
    assert.strictEqual(Object.keys(jobs).length, 1)
    assert.strictEqual(jobs['/workspace/test'].branch, 'new-branch')
  })
})

describe('updateJob', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-updatejob-' + Date.now())
  
  beforeEach(() => {
    process.env.OCDC_CACHE_DIR = testDir
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    delete process.env.OCDC_CACHE_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('updates status of existing job', async () => {
    await startJob('/workspace/test', 'repo', 'main')
    await updateJob('/workspace/test', JOB_STATUS.RUNNING)
    
    const jobs = await readJobs()
    assert.strictEqual(jobs['/workspace/test'].status, JOB_STATUS.RUNNING)
  })

  test('updates status to completed with port', async () => {
    await startJob('/workspace/test', 'repo', 'main')
    await updateJob('/workspace/test', JOB_STATUS.COMPLETED, { port: 13000 })
    
    const jobs = await readJobs()
    assert.strictEqual(jobs['/workspace/test'].status, JOB_STATUS.COMPLETED)
    assert.strictEqual(jobs['/workspace/test'].port, 13000)
    assert.ok(jobs['/workspace/test'].completedAt)
  })

  test('updates status to failed with error', async () => {
    await startJob('/workspace/test', 'repo', 'main')
    await updateJob('/workspace/test', JOB_STATUS.FAILED, { error: 'Docker not running' })
    
    const jobs = await readJobs()
    assert.strictEqual(jobs['/workspace/test'].status, JOB_STATUS.FAILED)
    assert.strictEqual(jobs['/workspace/test'].error, 'Docker not running')
    assert.ok(jobs['/workspace/test'].completedAt)
  })

  test('does nothing for unknown workspace', async () => {
    await updateJob('/workspace/unknown', JOB_STATUS.RUNNING)
    
    const jobs = await readJobs()
    assert.strictEqual(jobs['/workspace/unknown'], undefined)
  })

  test('preserves other job fields', async () => {
    await startJob('/workspace/test', 'my-repo', 'feature-branch')
    await updateJob('/workspace/test', JOB_STATUS.RUNNING)
    
    const jobs = await readJobs()
    assert.strictEqual(jobs['/workspace/test'].repo, 'my-repo')
    assert.strictEqual(jobs['/workspace/test'].branch, 'feature-branch')
  })
})

describe('getJob', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-getjob-' + Date.now())
  
  beforeEach(() => {
    process.env.OCDC_CACHE_DIR = testDir
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    delete process.env.OCDC_CACHE_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('returns job for existing workspace', async () => {
    await startJob('/workspace/test', 'repo', 'main')
    
    const job = await getJob('/workspace/test')
    assert.ok(job)
    assert.strictEqual(job.repo, 'repo')
    assert.strictEqual(job.branch, 'main')
  })

  test('returns null for unknown workspace', async () => {
    const job = await getJob('/workspace/unknown')
    assert.strictEqual(job, null)
  })
})

describe('cleanupJobs', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-cleanup-' + Date.now())
  
  beforeEach(() => {
    process.env.OCDC_CACHE_DIR = testDir
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    delete process.env.OCDC_CACHE_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('removes completed jobs older than maxAge', async () => {
    // Create an old completed job
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2 hours ago
    const jobs = {
      '/workspace/old': {
        status: JOB_STATUS.COMPLETED,
        repo: 'repo',
        branch: 'main',
        startedAt: oldTime,
        completedAt: oldTime,
      },
      '/workspace/new': {
        status: JOB_STATUS.COMPLETED,
        repo: 'repo',
        branch: 'main',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }
    }
    await writeJobs(jobs)
    
    // Cleanup with 1 hour max age for completed
    await cleanupJobs({ completedMaxAgeMs: 60 * 60 * 1000 })
    
    const remaining = await readJobs()
    assert.strictEqual(remaining['/workspace/old'], undefined)
    assert.ok(remaining['/workspace/new'])
  })

  test('removes failed jobs older than maxAge', async () => {
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() // 25 hours ago
    const jobs = {
      '/workspace/old-failed': {
        status: JOB_STATUS.FAILED,
        repo: 'repo',
        branch: 'main',
        startedAt: oldTime,
        completedAt: oldTime,
        error: 'Some error',
      },
      '/workspace/recent-failed': {
        status: JOB_STATUS.FAILED,
        repo: 'repo',
        branch: 'main',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: 'Recent error',
      }
    }
    await writeJobs(jobs)
    
    // Cleanup with 24 hour max age for failed
    await cleanupJobs({ failedMaxAgeMs: 24 * 60 * 60 * 1000 })
    
    const remaining = await readJobs()
    assert.strictEqual(remaining['/workspace/old-failed'], undefined)
    assert.ok(remaining['/workspace/recent-failed'])
  })

  test('does not remove pending or running jobs', async () => {
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    const jobs = {
      '/workspace/pending': {
        status: JOB_STATUS.PENDING,
        repo: 'repo',
        branch: 'main',
        startedAt: oldTime,
      },
      '/workspace/running': {
        status: JOB_STATUS.RUNNING,
        repo: 'repo',
        branch: 'main',
        startedAt: oldTime,
      }
    }
    await writeJobs(jobs)
    
    await cleanupJobs({ completedMaxAgeMs: 0, failedMaxAgeMs: 0 })
    
    const remaining = await readJobs()
    assert.ok(remaining['/workspace/pending'])
    assert.ok(remaining['/workspace/running'])
  })

  test('uses default max ages when not specified', async () => {
    // This test just verifies cleanup runs without error with defaults
    await startJob('/workspace/test', 'repo', 'main')
    await cleanupJobs()
    
    // Job should still exist (not old enough)
    const jobs = await readJobs()
    assert.ok(jobs['/workspace/test'])
  })
})

describe('JOB_STATUS constants', () => {
  test('has all expected status values', () => {
    assert.strictEqual(JOB_STATUS.PENDING, 'pending')
    assert.strictEqual(JOB_STATUS.RUNNING, 'running')
    assert.strictEqual(JOB_STATUS.COMPLETED, 'completed')
    assert.strictEqual(JOB_STATUS.FAILED, 'failed')
  })
})
