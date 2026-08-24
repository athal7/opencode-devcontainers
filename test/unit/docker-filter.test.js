/**
 * Tests for plugin/core/docker-filter.js
 *
 * Run with: node --test test/unit/docker-filter.test.js
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'

// Module under test
import { sanitizeDockerFilterValue } from '../../plugin/core/docker-filter.js'

describe('sanitizeDockerFilterValue', () => {
  test('returns a plain absolute path unchanged', () => {
    assert.strictEqual(
      sanitizeDockerFilterValue('/Users/dev/my-project'),
      '/Users/dev/my-project'
    )
  })

  test('accepts a path containing spaces', () => {
    assert.strictEqual(
      sanitizeDockerFilterValue('/Users/dev/my project (copy)'),
      '/Users/dev/my project (copy)'
    )
  })

  test('rejects a value containing a newline', () => {
    assert.throws(() => sanitizeDockerFilterValue('/workspace\n--filter label=foo=bar'))
  })

  test('rejects a value containing a carriage return', () => {
    assert.throws(() => sanitizeDockerFilterValue('/workspace\rinjected'))
  })

  test('rejects a value containing a NUL byte', () => {
    assert.throws(() => sanitizeDockerFilterValue('/workspace\0injected'))
  })

  test('rejects other C0 control characters', () => {
    assert.throws(() => sanitizeDockerFilterValue('/workspace\x1binjected'))
  })

  test('rejects a non-string value', () => {
    assert.throws(() => sanitizeDockerFilterValue(undefined))
    assert.throws(() => sanitizeDockerFilterValue(null))
    assert.throws(() => sanitizeDockerFilterValue(42))
  })
})
