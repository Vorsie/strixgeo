// Unit tests for the shared atomic-write helper that the recovery store and
// the project-file IPC both use (one copy in ./atomicWrite.ts).
//
// These run against a REAL temp directory rather than a stubbed fs, and they
// have to: the whole value of the helper is what it leaves on an actual disk
// when a write is interrupted, and a fake fs would let a wrong assumption
// about rename / unlink / ENOENT pass unnoticed. Mocking is not an option
// anyway — in this vitest setup a ``vi.mock('fs')`` reaches the test file's own
// import but NOT the module under test's, and ``vi.spyOn`` cannot touch a node
// builtin's namespace under ESM. Both failure paths below are therefore forced
// with real filesystem state.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeFileAtomic } from './atomicWrite'

let dir: string

/** The temp path ``writeFileAtomic`` will use for ``target`` in this process. */
function tempPathFor(target: string): string {
  return `${target}.tmp.${process.pid}`
}

/** Names of the ``.tmp.<pid>`` orphans currently sitting in the test dir. */
function tempOrphans(): string[] {
  return readdirSync(dir).filter(name => name.includes('.tmp.'))
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'strix-atomic-test-'))
})

afterEach(() => {
  // Restore write permission first — a read-only file left by a test would
  // otherwise survive the recursive remove on some platforms. 0o777, not
  // 0o666: chmod applies to directories too (it does NOT throw on them, as an
  // earlier revision assumed), and a POSIX directory without its execute bit
  // cannot be traversed — 0o666 on the blocked.json fixture dir made the
  // recursive remove EACCES on its child on the first Linux CI run.
  for (const name of readdirSync(dir)) {
    try {
      chmodSync(join(dir, name), 0o777)
    } catch {
      /* already gone */
    }
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('writeFileAtomic', () => {
  it('writes the contents and leaves no temp file behind', () => {
    const target = join(dir, 'thing.json')
    writeFileAtomic(target, '{"a":1}')
    expect(readFileSync(target, 'utf-8')).toBe('{"a":1}')
    expect(readdirSync(dir)).toEqual(['thing.json'])
  })

  it('replaces an existing file wholesale (no half-blend of old and new)', () => {
    const target = join(dir, 'thing.json')
    writeFileAtomic(target, 'a'.repeat(500))
    writeFileAtomic(target, 'b')
    expect(readFileSync(target, 'utf-8')).toBe('b')
  })

  it('cleans up the temp file when the rename fails, and rethrows', () => {
    // A non-empty directory standing where the target file should go makes the
    // rename fail on every platform, without disturbing the write itself.
    const target = join(dir, 'blocked.json')
    mkdirSync(join(target, 'occupant'), { recursive: true })

    expect(() => writeFileAtomic(target, '{"a":1}')).toThrow()
    expect(tempOrphans()).toEqual([])
  })

  // Binary callers: the DXF/Plaxis export IPC hands over an ArrayBuffer, and an
  // export that fails must not destroy the deliverable the engineer already
  // shipped. Both rules below were unreachable while the helper only accepted
  // a string — the export handler wrote with a plain truncating writeFileSync.
  it('writes binary contents byte-for-byte', () => {
    const target = join(dir, 'section.dxf')
    // Bytes that no UTF-8 round-trip survives: a NUL, a lone continuation byte
    // and 0xFF. If the helper ever stringifies its input these come back as
    // U+FFFD replacement characters instead.
    const bytes = new Uint8Array([0x00, 0x80, 0xff, 0x41])
    writeFileAtomic(target, bytes)
    expect(Array.from(readFileSync(target))).toEqual([0x00, 0x80, 0xff, 0x41])
  })

  it('leaves the previously exported file intact when the new export fails', () => {
    const target = join(dir, 'section.dxf')
    writeFileAtomic(target, new Uint8Array([0x67, 0x6f, 0x6f, 0x64])) // "good"
    // Force the replacement to fail the same way a locked / full disk does.
    const tmpPath = tempPathFor(target)
    writeFileSync(tmpPath, 'partial', 'utf-8')
    chmodSync(tmpPath, 0o444)

    expect(() => writeFileAtomic(target, new Uint8Array([0x62, 0x61, 0x64]))).toThrow()
    // The deliverable the engineer already sent out is still on disk, whole.
    expect(Array.from(readFileSync(target))).toEqual([0x67, 0x6f, 0x6f, 0x64])
    expect(tempOrphans()).toEqual([])
  })

  // The failure this test pins: an earlier revision wrapped only the rename, so
  // a write that died (disk full, quota, revoked permission) left its
  // ``.tmp.<pid>`` behind forever. The recovery directory is enumerated at every
  // launch, and one failed autosave per session accumulates orphans there — so
  // the cleanup has to cover the write as well as the rename.
  it('cleans up the temp file when the WRITE itself fails', () => {
    const target = join(dir, 'thing.json')
    const tmpPath = tempPathFor(target)
    // Stand-in for the un-writable disk: an existing, read-only temp. The write
    // fails (EPERM / EACCES) with a file sitting at exactly the path the helper
    // must clean up — which is what an interrupted write leaves too. Deleting
    // it still succeeds, because the containing directory stays writable.
    writeFileSync(tmpPath, 'partial from an earlier failed save', 'utf-8')
    chmodSync(tmpPath, 0o444)

    expect(() => writeFileAtomic(target, '{"a":1}')).toThrow()
    expect(tempOrphans()).toEqual([])
    // And the failed write did not leave a truncated target either.
    expect(existsSync(target)).toBe(false)
  })
})
