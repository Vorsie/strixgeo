import { describe, it, expect, beforeEach } from 'vitest'
import { shouldRotate, rotateIfNeeded, type FsOps } from './logRotation'

// ---------------------------------------------------------------------------
// shouldRotate — pure size comparison
// ---------------------------------------------------------------------------

describe('shouldRotate', () => {
  it('returns false when the log is below the threshold', () => {
    expect(shouldRotate(4 * 1024 * 1024, 5 * 1024 * 1024)).toBe(false)
  })

  it('returns true when the log equals the threshold', () => {
    expect(shouldRotate(5 * 1024 * 1024, 5 * 1024 * 1024)).toBe(true)
  })

  it('returns true when the log exceeds the threshold', () => {
    expect(shouldRotate(6 * 1024 * 1024, 5 * 1024 * 1024)).toBe(true)
  })

  it('returns false for a zero-size log', () => {
    expect(shouldRotate(0, 5 * 1024 * 1024)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// rotateIfNeeded — filesystem side-effects via stub FsOps
// ---------------------------------------------------------------------------

/** Build a fake in-memory filesystem for the rotation tests. */
function makeFakeFs(initialFiles: Record<string, number>): FsOps & {
  ops: { renames: Array<[string, string]>; unlinks: string[] }
  files: Record<string, number>
} {
  const files = { ...initialFiles }
  const ops = { renames: [] as Array<[string, string]>, unlinks: [] as string[] }

  return {
    files,
    ops,
    size: (p) => files[p] ?? 0,
    exists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    rename: (src, dest) => {
      ops.renames.push([src, dest])
      files[dest] = files[src] ?? 0
      delete files[src]
    },
    unlink: (p) => {
      ops.unlinks.push(p)
      delete files[p]
    },
  }
}

const LOG = '/logs/backend.log'
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_FILES = 3

describe('rotateIfNeeded', () => {
  it('returns false and touches nothing when log is below threshold', () => {
    const fs = makeFakeFs({ [LOG]: 1024 })
    const rotated = rotateIfNeeded(LOG, MAX_BYTES, MAX_FILES, fs)
    expect(rotated).toBe(false)
    expect(fs.ops.renames).toHaveLength(0)
    expect(fs.ops.unlinks).toHaveLength(0)
  })

  it('returns false when log file does not exist (size 0)', () => {
    const fs = makeFakeFs({})
    const rotated = rotateIfNeeded(LOG, MAX_BYTES, MAX_FILES, fs)
    expect(rotated).toBe(false)
  })

  it('rotates primary log to .1 when only the primary exists', () => {
    const fs = makeFakeFs({ [LOG]: MAX_BYTES })
    const rotated = rotateIfNeeded(LOG, MAX_BYTES, MAX_FILES, fs)
    expect(rotated).toBe(true)
    // Primary renamed to .1
    expect(fs.ops.renames).toContainEqual([LOG, `${LOG}.1`])
    // .1 no longer at original path
    expect(fs.files[LOG]).toBeUndefined()
    expect(fs.files[`${LOG}.1`]).toBeDefined()
  })

  it('shifts .1 → .2 before rotating primary to .1', () => {
    const fs = makeFakeFs({ [LOG]: MAX_BYTES, [`${LOG}.1`]: 1024 })
    rotateIfNeeded(LOG, MAX_BYTES, MAX_FILES, fs)
    expect(fs.ops.renames).toContainEqual([`${LOG}.1`, `${LOG}.2`])
    expect(fs.ops.renames).toContainEqual([LOG, `${LOG}.1`])
  })

  it('drops the oldest file (.3) when all three backup slots are full', () => {
    const fs = makeFakeFs({
      [LOG]: MAX_BYTES,
      [`${LOG}.1`]: 1024,
      [`${LOG}.2`]: 1024,
      [`${LOG}.3`]: 1024,
    })
    rotateIfNeeded(LOG, MAX_BYTES, MAX_FILES, fs)
    // Oldest must be unlinked
    expect(fs.ops.unlinks).toContain(`${LOG}.3`)
    // Full chain shift: .2→.3, .1→.2, log→.1
    expect(fs.ops.renames).toContainEqual([`${LOG}.2`, `${LOG}.3`])
    expect(fs.ops.renames).toContainEqual([`${LOG}.1`, `${LOG}.2`])
    expect(fs.ops.renames).toContainEqual([LOG, `${LOG}.1`])
    // No .4 created
    expect(fs.files[`${LOG}.4`]).toBeUndefined()
  })

  it('does not throw when an intermediate backup generation is absent', () => {
    // .1 is missing but .2 is present — the rotate shifts .2 → .3 (because
    // the loop still runs the higher generations), skips the .1 → .2 step
    // (exists check is false for .1), and renames log → .1.
    // The key invariant is: no exception, and no spurious .4 is created.
    const fs = makeFakeFs({ [LOG]: MAX_BYTES, [`${LOG}.2`]: 1024 })
    expect(() => rotateIfNeeded(LOG, MAX_BYTES, MAX_FILES, fs)).not.toThrow()
    // .2 was shifted to .3; .1 was skipped (didn't exist → no-op rename).
    expect(fs.files[`${LOG}.3`]).toBeDefined()
    expect(fs.files[`${LOG}.4`]).toBeUndefined()
  })
})
