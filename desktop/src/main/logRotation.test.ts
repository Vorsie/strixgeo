import { describe, it, expect } from 'vitest'
import {
  shouldRotate,
  rotateIfNeeded,
  createRotatingAppender,
  type FsOps,
} from './logRotation'

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

// ---------------------------------------------------------------------------
// createRotatingAppender — M8/L1/Codex-10: rotate DURING a session, not only at
// launch. A long verbose run appended past the 5 MB cap until restart.
// ---------------------------------------------------------------------------

/** A fake fs that also grows a file on append, for the appender tests. */
function makeAppendableFs(): FsOps & {
  append: (path: string, text: string) => void
  files: Record<string, number>
  renames: Array<[string, string]>
} {
  const files: Record<string, number> = {}
  const renames: Array<[string, string]> = []
  return {
    files,
    renames,
    size: (p) => files[p] ?? 0,
    exists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    rename: (src, dest) => {
      renames.push([src, dest])
      files[dest] = files[src] ?? 0
      delete files[src]
    },
    unlink: (p) => {
      delete files[p]
    },
    append: (p, text) => {
      files[p] = (files[p] ?? 0) + text.length
    },
  }
}

describe('createRotatingAppender', () => {
  const TINY_CAP = 100

  it('rotates the active log mid-session once it grows past the cap', () => {
    const fs = makeAppendableFs()
    // checkEveryBytes = 1 → check on every append, so the tiny cap is exact.
    const write = createRotatingAppender(LOG, TINY_CAP, MAX_FILES, { fs, append: fs.append }, 1)

    // A 50-char line becomes 51 bytes (trailing newline). Two of them cross 100.
    const line = 'x'.repeat(50)
    write(line) // ~51 bytes — under the cap
    expect(fs.renames).toHaveLength(0)

    write(line) // ~102 bytes — at/over the cap → rotate
    expect(fs.renames).toContainEqual([LOG, `${LOG}.1`])
    // The active log started fresh after the rotation (the just-crossed content
    // is now in .1), so it is bounded again.
    expect(fs.files[LOG] ?? 0).toBeLessThan(TINY_CAP)
    expect(fs.files[`${LOG}.1`]).toBeGreaterThanOrEqual(TINY_CAP)
  })

  it('keeps the active log bounded across a long burst of writes', () => {
    const fs = makeAppendableFs()
    const write = createRotatingAppender(LOG, TINY_CAP, MAX_FILES, { fs, append: fs.append }, 1)

    const line = 'y'.repeat(40) // 41 bytes each
    for (let i = 0; i < 200; i++) write(line)

    // Without mid-session rotation the file would be ~8200 bytes (82x the cap).
    // With it, the active log never runs far past the cap + one line.
    expect(fs.files[LOG] ?? 0).toBeLessThanOrEqual(TINY_CAP + 41)
    expect(fs.renames.length).toBeGreaterThan(0)
  })

  it('appends the newline itself and only stats every checkEveryBytes', () => {
    const fs = makeAppendableFs()
    const statSpy: number[] = []
    const countingFs: FsOps = {
      ...fs,
      size: (p) => {
        statSpy.push(1)
        return fs.files[p] ?? 0
      },
    }
    // checkEveryBytes large enough that a couple of short writes never trigger a
    // size check → no I/O beyond the appends.
    const write = createRotatingAppender(
      LOG,
      5 * 1024 * 1024,
      MAX_FILES,
      { fs: countingFs, append: fs.append },
      64 * 1024,
    )
    write('hello')
    write('world')
    // 5 + 1 + 5 + 1 = 12 bytes appended, far below 64 KiB → the size stat that
    // rotateIfNeeded performs is never reached.
    expect(statSpy).toHaveLength(0)
    // The newline is added by the appender, so each line grew the file by len+1.
    expect(fs.files[LOG]).toBe(12)
  })
})
