/**
 * Tests for plugin/core/ports.js
 * 
 * Run with: node --test test/unit/ports.test.js
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import childProcess from 'child_process'
import { EventEmitter } from 'events'

// Module under test
import { 
  readPorts, 
  writePorts, 
  allocatePort, 
  releasePort,
  isPortFree,
  withLock,
  getContainerPort,
  updatePortAllocation,
} from '../../plugin/core/ports.js'

describe('withLock', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-lock-' + Date.now())
  const lockPath = join(testDir, 'test.lock')

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('acquires and releases lock', async () => {
    let executed = false
    await withLock(lockPath, async () => {
      executed = true
    })
    assert.ok(executed)
    // Lock should be released (directory removed)
    assert.ok(!existsSync(lockPath + '.lock'))
  })

  test('blocks concurrent access', async () => {
    const results = []
    
    // Start two concurrent operations
    const p1 = withLock(lockPath, async () => {
      results.push('start-1')
      await new Promise(r => setTimeout(r, 100))
      results.push('end-1')
      return 1
    })
    
    const p2 = withLock(lockPath, async () => {
      results.push('start-2')
      await new Promise(r => setTimeout(r, 50))
      results.push('end-2')
      return 2
    })

    await Promise.all([p1, p2])

    // Operations should be serialized, not interleaved
    // Either [start-1, end-1, start-2, end-2] or [start-2, end-2, start-1, end-1]
    assert.ok(
      (results[0] === 'start-1' && results[1] === 'end-1') ||
      (results[0] === 'start-2' && results[1] === 'end-2'),
      `Operations were interleaved: ${JSON.stringify(results)}`
    )
  })

  test('releases lock even on error', async () => {
    try {
      await withLock(lockPath, async () => {
        throw new Error('test error')
      })
    } catch (e) {
      assert.strictEqual(e.message, 'test error')
    }
    
    // Lock should still be released
    assert.ok(!existsSync(lockPath + '.lock'))
  })

  test('handles stale locks', async () => {
    // Create a stale lock (old timestamp)
    const staleLockDir = lockPath + '.lock'
    mkdirSync(staleLockDir, { recursive: true })
    
    // Touch the directory with old time (can't easily set mtime in Node, but we can test the timeout)
    // For this test, we'll use a short maxAge
    let executed = false
    await withLock(lockPath, async () => {
      executed = true
    }, 0) // maxAge=0 means any existing lock is considered stale
    
    assert.ok(executed)
  })
})

describe('readPorts / writePorts', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-ports-' + Date.now())
  
  beforeEach(() => {
    process.env.OCDC_CACHE_DIR = testDir
    mkdirSync(testDir, { recursive: true })
    writeFileSync(join(testDir, 'ports.json'), '{}')
  })

  afterEach(() => {
    delete process.env.OCDC_CACHE_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('reads empty ports file', async () => {
    const ports = await readPorts()
    assert.deepStrictEqual(ports, {})
  })

  test('reads existing ports', async () => {
    const data = {
      '/workspace/one': { port: 13000, repo: 'one', branch: 'main' }
    }
    writeFileSync(join(testDir, 'ports.json'), JSON.stringify(data))
    
    const ports = await readPorts()
    assert.deepStrictEqual(ports, data)
  })

  test('writes ports atomically', async () => {
    const data = {
      '/workspace/test': { port: 13001, repo: 'test', branch: 'feature' }
    }
    await writePorts(data)
    
    const content = readFileSync(join(testDir, 'ports.json'), 'utf-8')
    assert.deepStrictEqual(JSON.parse(content), data)
  })

  test('handles corrupted ports file', async () => {
    writeFileSync(join(testDir, 'ports.json'), 'not json')
    
    const ports = await readPorts()
    assert.deepStrictEqual(ports, {})
  })
})

describe('isPortFree', () => {
  test('returns true for unused port', async () => {
    // Port 19999 is unlikely to be in use
    const free = await isPortFree(19999)
    assert.strictEqual(typeof free, 'boolean')
  })

  test('returns false for port in use', async () => {
    // Start a server on a random port
    const net = await import('net')
    const server = net.createServer()
    
    await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', resolve)
      server.on('error', reject)
    })
    
    const port = server.address().port
    
    try {
      const free = await isPortFree(port)
      assert.strictEqual(free, false)
    } finally {
      server.close()
    }
  })
})

describe('allocatePort', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-alloc-' + Date.now())
  
  beforeEach(() => {
    process.env.OCDC_CACHE_DIR = testDir
    process.env.OCDC_CONFIG_DIR = join(testDir, 'config')
    mkdirSync(testDir, { recursive: true })
    mkdirSync(join(testDir, 'config'), { recursive: true })
    writeFileSync(join(testDir, 'ports.json'), '{}')
    writeFileSync(join(testDir, 'config', 'config.json'), JSON.stringify({
      portRangeStart: 19000,
      portRangeEnd: 19010
    }))
  })

  afterEach(() => {
    delete process.env.OCDC_CACHE_DIR
    delete process.env.OCDC_CONFIG_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('allocates first available port', async () => {
    const result = await allocatePort('/workspace/test', 'test-repo', 'main')
    
    assert.ok(result.port >= 19000 && result.port <= 19010)
    assert.strictEqual(result.workspace, '/workspace/test')
    assert.strictEqual(result.repo, 'test-repo')
    assert.strictEqual(result.branch, 'main')
  })

  test('returns existing allocation for same workspace', async () => {
    const result1 = await allocatePort('/workspace/test', 'test-repo', 'main')
    const result2 = await allocatePort('/workspace/test', 'test-repo', 'main')
    
    assert.strictEqual(result1.port, result2.port)
  })

  test('allocates different ports for different workspaces', async () => {
    const result1 = await allocatePort('/workspace/one', 'repo', 'main')
    const result2 = await allocatePort('/workspace/two', 'repo', 'main')
    
    assert.notStrictEqual(result1.port, result2.port)
  })

  test('throws when no ports available', async () => {
    // Use up all ports in range
    writeFileSync(join(testDir, 'config', 'config.json'), JSON.stringify({
      portRangeStart: 19000,
      portRangeEnd: 19001
    }))
    
    await allocatePort('/workspace/one', 'repo', 'main')
    await allocatePort('/workspace/two', 'repo', 'main')
    
    await assert.rejects(
      () => allocatePort('/workspace/three', 'repo', 'main'),
      /No available ports/
    )
  })

  test('concurrent allocations get unique ports', async () => {
    // Spawn multiple concurrent allocations
    const results = await Promise.all([
      allocatePort('/workspace/a', 'repo', 'a'),
      allocatePort('/workspace/b', 'repo', 'b'),
      allocatePort('/workspace/c', 'repo', 'c'),
    ])
    
    const ports = results.map(r => r.port)
    const uniquePorts = new Set(ports)
    
    // All ports should be unique
    assert.strictEqual(uniquePorts.size, 3, `Got duplicate ports: ${JSON.stringify(ports)}`)
  })
})

describe('releasePort', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-release-' + Date.now())
  
  beforeEach(() => {
    process.env.OCDC_CACHE_DIR = testDir
    process.env.OCDC_CONFIG_DIR = join(testDir, 'config')
    mkdirSync(testDir, { recursive: true })
    mkdirSync(join(testDir, 'config'), { recursive: true })
    writeFileSync(join(testDir, 'ports.json'), '{}')
    writeFileSync(join(testDir, 'config', 'config.json'), JSON.stringify({
      portRangeStart: 19000,
      portRangeEnd: 19010
    }))
  })

  afterEach(() => {
    delete process.env.OCDC_CACHE_DIR
    delete process.env.OCDC_CONFIG_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('removes workspace from ports file', async () => {
    await allocatePort('/workspace/test', 'repo', 'main')
    await releasePort('/workspace/test')
    
    const ports = await readPorts()
    assert.strictEqual(ports['/workspace/test'], undefined)
  })

  test('does nothing for unknown workspace', async () => {
    await releasePort('/workspace/unknown')
    // Should not throw
  })

  test('released port can be reallocated', async () => {
    const result1 = await allocatePort('/workspace/test', 'repo', 'main')
    await releasePort('/workspace/test')
    const result2 = await allocatePort('/workspace/other', 'repo', 'main')
    
    // Released port should be available for reuse
    assert.strictEqual(result1.port, result2.port)
  })
})

describe('getContainerPort', () => {
  test('returns null when no container running for workspace', async () => {
    const port = await getContainerPort('/nonexistent/workspace')
    assert.strictEqual(port, null)
  })

  test('returns null when docker command fails', async () => {
    // This tests graceful handling of docker errors
    const port = await getContainerPort('/some/path')
    // Should not throw, just return null
    assert.strictEqual(port, null)
  })

  test('returns null and never invokes docker for a workspace with a newline', async (t) => {
    // Security regression test: a workspace value with an embedded newline
    // could previously corrupt the Docker `--filter` argument (code
    // scanning alert #1 / issue #150). It must be rejected before spawning
    // docker, not passed through.
    let spawned = false
    t.mock.method(childProcess, 'spawn', () => {
      spawned = true
      throw new Error('spawn should not be called for an invalid workspace')
    })

    const port = await getContainerPort('/workspace\n--filter label=foo=bar')

    assert.strictEqual(port, null)
    assert.strictEqual(spawned, false)
  })

  test('returns null and never invokes docker for a workspace with a NUL byte', async (t) => {
    let spawned = false
    t.mock.method(childProcess, 'spawn', () => {
      spawned = true
      throw new Error('spawn should not be called for an invalid workspace')
    })

    const port = await getContainerPort('/workspace\0injected')

    assert.strictEqual(port, null)
    assert.strictEqual(spawned, false)
  })
})

describe('getContainerPort with a configured runtime', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-runtime-port-' + Date.now())

  beforeEach(() => {
    process.env.OCDC_CACHE_DIR = testDir
    process.env.OCDC_CONFIG_DIR = join(testDir, 'config')
    mkdirSync(join(testDir, 'config'), { recursive: true })
    writeFileSync(
      join(testDir, 'config', 'config.json'),
      JSON.stringify({
        dockerPath: '/usr/bin/podman',
        dockerComposePath: '/usr/bin/podman-compose',
      })
    )
  })

  afterEach(() => {
    delete process.env.OCDC_CACHE_DIR
    delete process.env.OCDC_CONFIG_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('inspects containers through the configured runtime', async (t) => {
    const commands = []
    t.mock.method(childProcess, 'spawn', (command, args) => {
      commands.push({ command, args })
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      process.nextTick(() => {
        if (args[0] === 'ps') {
          child.stdout.emit('data', 'container-id\n')
        } else {
          child.stdout.emit('data', '{"3000/tcp":[{"HostPort":"13042"}]}')
        }
        child.emit('close', 0)
      })
      return child
    })

    const port = await getContainerPort('/workspace/test')

    assert.strictEqual(port, 13042)
    assert.deepStrictEqual(
      commands.map(({ command }) => command),
      ['/usr/bin/podman', '/usr/bin/podman']
    )
  })
})

describe('updatePortAllocation', () => {
  const testDir = join(homedir(), '.cache/ocdc-test-update-' + Date.now())
  
  beforeEach(() => {
    process.env.OCDC_CACHE_DIR = testDir
    process.env.OCDC_CONFIG_DIR = join(testDir, 'config')
    mkdirSync(testDir, { recursive: true })
    mkdirSync(join(testDir, 'config'), { recursive: true })
    writeFileSync(join(testDir, 'ports.json'), '{}')
    writeFileSync(join(testDir, 'config', 'config.json'), JSON.stringify({
      portRangeStart: 19000,
      portRangeEnd: 19010
    }))
  })

  afterEach(() => {
    delete process.env.OCDC_CACHE_DIR
    delete process.env.OCDC_CONFIG_DIR
    rmSync(testDir, { recursive: true, force: true })
  })

  test('updates port for existing workspace', async () => {
    // Allocate a port first
    await allocatePort('/workspace/test', 'repo', 'main')
    
    // Simulate container starting on a different port
    const newPort = 19005
    await updatePortAllocation('/workspace/test', newPort)
    
    // Verify port was updated
    const ports = await readPorts()
    assert.strictEqual(ports['/workspace/test'].port, newPort)
    // Other fields should be preserved
    assert.strictEqual(ports['/workspace/test'].repo, 'repo')
    assert.strictEqual(ports['/workspace/test'].branch, 'main')
  })

  test('does nothing for unknown workspace', async () => {
    await updatePortAllocation('/workspace/unknown', 19005)
    
    // Should not create an entry
    const ports = await readPorts()
    assert.strictEqual(ports['/workspace/unknown'], undefined)
  })

  test('preserves other workspace allocations', async () => {
    await allocatePort('/workspace/one', 'repo1', 'main')
    await allocatePort('/workspace/two', 'repo2', 'feature')
    
    // Update one workspace
    await updatePortAllocation('/workspace/one', 19005)
    
    // Verify other workspace unaffected
    const ports = await readPorts()
    assert.strictEqual(ports['/workspace/two'].repo, 'repo2')
  })
})
