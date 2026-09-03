// M1 — moving an EXISTING Roaming pgdata to Local on first launch of the new
// layout. This machine already has an installed profile with a live pgdata under
// Roaming, so the split must relocate it (rename, or copy+verify+delete across
// volumes) BEFORE Postgres starts, and never strand or destroy the cluster.

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  decidePgdataMigration,
  migratePgdata,
  realPgdataFsOps,
  type PgdataFsOps,
} from './pgdataMigration'

const noop = (): void => {}

describe('decidePgdataMigration', () => {
  it('moves only when the Roaming source exists and the Local dest does not', () => {
    expect(decidePgdataMigration(true, false)).toBe('move')
  })

  it('skips when the source is absent (fresh install — nothing to move)', () => {
    expect(decidePgdataMigration(false, false)).toBe('skip')
  })

  it('skips when the dest already exists (already migrated, or a fresh Local cluster)', () => {
    expect(decidePgdataMigration(true, true)).toBe('skip')
    expect(decidePgdataMigration(false, true)).toBe('skip')
  })
})

/** A fake fs whose rename can be told to throw a chosen error. */
function fakeFs(
  present: Set<string>,
  renameError?: unknown,
): PgdataFsOps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    exists: (p) => present.has(p),
    rename: (src, dest) => {
      calls.push(`rename ${src} ${dest}`)
      if (renameError) throw renameError
      present.delete(src)
      present.add(dest)
    },
    copyDir: (src, dest) => {
      calls.push(`copyDir ${src} ${dest}`)
      present.add(dest)
      present.add(join(dest, 'PG_VERSION')) // a valid copy carries the version stamp
    },
    removeDir: (p) => {
      calls.push(`removeDir ${p}`)
      present.delete(p)
    },
    isCrossVolume: (err) => (err as NodeJS.ErrnoException)?.code === 'EXDEV',
  }
}

describe('migratePgdata (injected fs)', () => {
  it('renames the cluster when source→dest is a same-volume move', () => {
    const fs = fakeFs(new Set(['/roam/pgdata']))
    expect(migratePgdata('/roam/pgdata', '/local/pgdata', fs, noop)).toBe('moved')
    expect(fs.calls).toContain('rename /roam/pgdata /local/pgdata')
  })

  it('does nothing when there is nothing to move', () => {
    const fs = fakeFs(new Set())
    expect(migratePgdata('/roam/pgdata', '/local/pgdata', fs, noop)).toBe('skipped')
    expect(fs.calls).toHaveLength(0)
  })

  it('falls back to copy+verify+delete on a cross-volume (EXDEV) rename', () => {
    const exdev = Object.assign(new Error('cross-device'), { code: 'EXDEV' })
    const fs = fakeFs(new Set(['/roam/pgdata']), exdev)
    expect(migratePgdata('/roam/pgdata', '/local/pgdata', fs, noop)).toBe('moved')
    expect(fs.calls).toContain('copyDir /roam/pgdata /local/pgdata')
    expect(fs.calls).toContain('removeDir /roam/pgdata') // original removed only after a verified copy
  })

  it('keeps the original if a cross-volume copy fails verification', () => {
    const exdev = Object.assign(new Error('cross-device'), { code: 'EXDEV' })
    const fs = fakeFs(new Set(['/roam/pgdata']), exdev)
    // Break the copy: no PG_VERSION lands in the dest.
    fs.copyDir = (_src, dest) => {
      fs.calls.push(`copyDir ${_src} ${dest}`)
      // deliberately does NOT create PG_VERSION
    }
    expect(migratePgdata('/roam/pgdata', '/local/pgdata', fs, noop)).toBe('failed')
    // The half-copied dest is cleaned up and the source is never removed.
    expect(fs.calls).toContain('removeDir /local/pgdata')
    expect(fs.calls).not.toContain('removeDir /roam/pgdata')
  })

  it('reports failure and keeps the original on a non-cross-volume rename error', () => {
    const eperm = Object.assign(new Error('locked'), { code: 'EPERM' })
    const fs = fakeFs(new Set(['/roam/pgdata']), eperm)
    expect(migratePgdata('/roam/pgdata', '/local/pgdata', fs, noop)).toBe('failed')
    expect(fs.calls).not.toContain('copyDir /roam/pgdata /local/pgdata')
  })
})

describe('migratePgdata (real fs, temp dir)', () => {
  const temps: string[] = []
  afterEach(() => {
    for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true })
  })

  it('relocates a real cluster directory on disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'pgdata-mig-'))
    temps.push(root)
    const source = join(root, 'roam', 'pgdata')
    const dest = join(root, 'local', 'pgdata')
    mkdirSync(join(root, 'local'), { recursive: true })
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'PG_VERSION'), '16\n')
    writeFileSync(join(source, 'postgresql.conf'), '# cluster config\n')

    const log = vi.fn()
    expect(migratePgdata(source, dest, realPgdataFsOps(), log)).toBe('moved')

    expect(existsSync(source)).toBe(false)
    expect(readFileSync(join(dest, 'PG_VERSION'), 'utf8')).toBe('16\n')
    expect(existsSync(join(dest, 'postgresql.conf'))).toBe(true)
    expect(log).toHaveBeenCalled()
  })
})
