import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { createHash } from 'crypto'

import { remove } from '../../plugin/core/devcontainer.js'
import { readJobs } from '../../plugin/core/jobs.js'
import { getOverridePath } from '../../plugin/core/config.js'
import { PATHS } from '../../plugin/core/paths.js'

const IMAGE = 'alpine:3.19'

describe('remove (integration)', () => {
  const testDir = join(homedir(), '.cache/ocdc-int-rm-' + Date.now())
  const workspace = join(testDir, 'clones', 'my-repo', 'feature-x')
  const repo = 'my-repo'
  const branch = 'feature-x'

  let decoyId = null
  let devcontainerId = null

  before(() => {
    process.env.OCDC_CACHE_DIR = testDir
    process.env.OCDC_CONFIG_DIR = join(testDir, 'config')
    process.env.OCDC_CLONES_DIR = join(testDir, 'clones')

    // Ensure alpine image is available
    execSync(`docker pull ${IMAGE}`, { stdio: 'pipe' })

    // Create complete devcontainer workspace state
    mkdirSync(join(testDir, 'config'), { recursive: true })
    writeFileSync(join(testDir, 'config', 'config.json'), JSON.stringify({
      portRangeStart: 19000, portRangeEnd: 19010,
    }))

    writeFileSync(join(testDir, 'ports.json'), JSON.stringify({
      [workspace]: { port: 19000, repo, branch, started: new Date().toISOString() },
    }))

    writeFileSync(join(testDir, 'jobs.json'), JSON.stringify({
      [workspace]: { workspace, repo, branch, status: 'completed', startedAt: new Date().toISOString() },
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
      branch, workspace, repoName: repo, type: 'devcontainer',
    }))
    writeFileSync(join(sessionsDir, 'other-session.json'), JSON.stringify({
      branch: 'other', workspace: '/other/workspace', repoName: 'other', type: 'devcontainer',
    }))

    // Create decoy container (plain Docker, no devcontainer label)
    decoyId = execSync(
      `docker run -d --name ocdc-int-test-decoy ${IMAGE} tail -f /dev/null`,
      { encoding: 'utf-8' }
    ).trim()

    // Create devcontainer container with the label remove() uses to find it
    devcontainerId = execSync(
      `docker run -d --label devcontainer.local_folder=${workspace} ${IMAGE} tail -f /dev/null`,
      { encoding: 'utf-8' }
    ).trim()
  })

  after(() => {
    // Force-clean any leftover containers
    try { execSync(`docker rm -f ${decoyId}`, { stdio: 'ignore' }) } catch {}
    try {
      // Find and clean any remaining devcontainer-labelled containers
      const remaining = execSync(
        'docker ps -a -q --filter label=devcontainer.local_folder',
        { encoding: 'utf-8' }
      ).trim()
      if (remaining) {
        execSync(`docker rm -f ${remaining}`, { stdio: 'ignore' })
      }
    } catch {}

    delete process.env.OCDC_CACHE_DIR
    delete process.env.OCDC_CONFIG_DIR
    delete process.env.OCDC_CLONES_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('removes devcontainer while leaving unrelated containers untouched', async () => {
    // Sanity check: both containers exist and decoy is running
    const decoyBefore = execSync(
      `docker inspect ${decoyId} --format '{{.State.Status}}'`,
      { encoding: 'utf-8' }
    ).trim()
    assert.strictEqual(decoyBefore, 'running', 'decoy should be running before remove')

    const devStatusBefore = execSync(
      `docker inspect ${devcontainerId} --format '{{.State.Status}}'`,
      { encoding: 'utf-8' }
    ).trim()
    assert.strictEqual(devStatusBefore, 'running', 'devcontainer should be running before remove')

    // Act
    const summary = await remove(workspace, repo, branch)

    // Assert all Docker fields are true
    assert.strictEqual(summary.containerFound, true, 'container found')
    assert.strictEqual(summary.containerStopped, true, 'container stopped')
    assert.strictEqual(summary.containerRemoved, true, 'container removed')
    assert.strictEqual(summary.imageRemoved, true, 'image removed')

    // Assert all filesystem cleanup fields
    assert.strictEqual(summary.portReleased, true)
    assert.strictEqual(summary.jobRemoved, true)
    assert.strictEqual(summary.overrideDeleted, true)
    assert.strictEqual(summary.cloneDeleted, true)
    assert.strictEqual(summary.sessionsCleaned, 1)

    // Verify devcontainer container is gone
    const remaining = execSync(
      'docker ps -a -q --filter label=devcontainer.local_folder',
      { encoding: 'utf-8' }
    ).trim()
    assert.strictEqual(remaining, '', 'no containers with devcontainer label remain')

    // Verify devcontainer container ID no longer exists
    try {
      execSync(`docker inspect ${devcontainerId}`, { stdio: 'pipe' })
      assert.fail('devcontainer container should no longer exist')
    } catch {
      // Expected — container was removed
    }

    // Verify filesystem artifacts
    const ports = JSON.parse(readFileSync(join(testDir, 'ports.json'), 'utf-8'))
    assert.strictEqual(ports[workspace], undefined, 'port entry removed')

    const jobs = await readJobs()
    assert.strictEqual(jobs[workspace], undefined, 'job entry removed')

    assert.ok(!existsSync(getOverridePath(workspace)), 'override config deleted')
    assert.ok(!existsSync(workspace), 'clone folder deleted')

    const sessionFile = join(PATHS.sessions, 'test-session.json')
    const otherSessionFile = join(PATHS.sessions, 'other-session.json')
    assert.ok(!existsSync(sessionFile), 'matching session cleaned')
    assert.ok(existsSync(otherSessionFile), 'other session preserved')

    // Verify decoy is still running and untouched
    const decoyAfter = execSync(
      `docker inspect ${decoyId} --format '{{.State.Status}}'`,
      { encoding: 'utf-8' }
    ).trim()
    assert.strictEqual(decoyAfter, 'running', 'decoy container was not affected')

    // Verify no errors reported
    assert.strictEqual(summary.errors.length, 0, JSON.stringify(summary.errors))
  })
})
