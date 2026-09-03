// Unit tests for the data-dir-scaled migration timeout (production-readiness
// audit M8). A fixed 180 s timeout kills a legitimately slow migration on a
// large store and retries it every launch. The rule pinned here: the timeout
// scales with the data-directory size (+60 s per GB) on top of a fixed base.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BASE_MIGRATION_TIMEOUT_MS,
  directorySizeBytes,
  migrationTimeoutMs,
} from './embeddedStack'

const GIB = 1024 * 1024 * 1024

describe('migrationTimeoutMs', () => {
  it('an empty data directory gets exactly the base timeout', () => {
    expect(migrationTimeoutMs(0)).toBe(BASE_MIGRATION_TIMEOUT_MS)
  })

  it('adds sixty seconds per whole gigabyte of data-directory size', () => {
    // 1.5 GB → one whole GB of headroom (floored).
    expect(migrationTimeoutMs(1.5 * GIB)).toBe(BASE_MIGRATION_TIMEOUT_MS + 60_000)
    // 3 GB → three.
    expect(migrationTimeoutMs(3 * GIB)).toBe(BASE_MIGRATION_TIMEOUT_MS + 3 * 60_000)
  })

  it('never returns less than the base timeout', () => {
    expect(migrationTimeoutMs(-5)).toBeGreaterThanOrEqual(BASE_MIGRATION_TIMEOUT_MS)
  })
})

describe('directorySizeBytes', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'strix-datadir-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('sums file sizes recursively across nested subdirectories', () => {
    writeFileSync(join(dir, 'a.bin'), Buffer.alloc(100))
    mkdirSync(join(dir, 'base'))
    writeFileSync(join(dir, 'base', 'b.bin'), Buffer.alloc(250))
    expect(directorySizeBytes(dir)).toBe(350)
  })

  it('returns 0 for a path that does not exist (best-effort, never throws)', () => {
    expect(directorySizeBytes(join(dir, 'missing'))).toBe(0)
  })
})
