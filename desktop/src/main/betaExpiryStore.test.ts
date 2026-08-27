/**
 * The clock anchor survives across launches and only ever moves forward.
 *
 * These cases are about the FILE — {@link betaExpiry} already pins the rules.
 * What matters here: a tester who deletes or edits the file must not end up
 * better off than one who leaves it alone.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BETA_ANCHOR_FILENAME,
  clockAnchorPath,
  configureBetaExpiryStore,
  readClockAnchor,
  recordLaunch,
  resetBetaExpiryStoreForTests,
} from './betaExpiryStore'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'strix-beta-anchor-'))
  configureBetaExpiryStore({ userDataDir: dir })
})

afterEach(() => {
  resetBetaExpiryStoreForTests()
  rmSync(dir, { recursive: true, force: true })
})

describe('the anchor file', () => {
  it('BA1 — a first launch has no anchor to read', () => {
    expect(readClockAnchor()).toBeNull()
  })

  it('BA2 — a launch writes the anchor, and the next launch reads it back', () => {
    recordLaunch(1_000_000)

    expect(readClockAnchor()).toEqual({ firstSeenMs: 1_000_000, lastSeenMs: 1_000_000 })
  })

  it('BA3 — a later launch moves the last-seen timestamp forward on disk', () => {
    recordLaunch(1_000_000)
    recordLaunch(9_000_000)

    expect(readClockAnchor()).toEqual({ firstSeenMs: 1_000_000, lastSeenMs: 9_000_000 })
  })

  it('BA4 — a launch on a backdated clock does not rewind what is on disk', () => {
    recordLaunch(9_000_000)
    recordLaunch(1_000_000)

    expect(readClockAnchor()?.lastSeenMs).toBe(9_000_000)
  })

  it('BA5 — the file lives under the configured user-data directory', () => {
    expect(clockAnchorPath()).toBe(join(dir, BETA_ANCHOR_FILENAME))
  })
})

describe('a damaged or hand-edited anchor is not trusted', () => {
  it('BA6 — unparseable JSON reads as no anchor', () => {
    writeFileSync(clockAnchorPath(), '{ not json', 'utf-8')

    expect(readClockAnchor()).toBeNull()
  })

  it('BA7 — a file from another app is ignored', () => {
    writeFileSync(
      clockAnchorPath(),
      JSON.stringify({ kind: 'something.else', firstSeenMs: 1, lastSeenMs: 2 }),
      'utf-8',
    )

    expect(readClockAnchor()).toBeNull()
  })

  it('BA8 — timestamps that are not finite numbers are ignored', () => {
    writeFileSync(
      clockAnchorPath(),
      JSON.stringify({ kind: 'strixgeo.beta-anchor', format_version: 1, firstSeenMs: 'x', lastSeenMs: null }),
      'utf-8',
    )

    expect(readClockAnchor()).toBeNull()
  })

  it('BA9 — an anchor whose last-seen precedes its first-seen is ignored', () => {
    writeFileSync(
      clockAnchorPath(),
      JSON.stringify({
        kind: 'strixgeo.beta-anchor',
        format_version: 1,
        firstSeenMs: 9_000_000,
        lastSeenMs: 1_000_000,
      }),
      'utf-8',
    )

    expect(readClockAnchor()).toBeNull()
  })

  it('BA10 — a launch after a damaged read reseeds the file rather than throwing', () => {
    writeFileSync(clockAnchorPath(), 'garbage', 'utf-8')

    const anchor = recordLaunch(5_000_000)

    expect(anchor).toEqual({ firstSeenMs: 5_000_000, lastSeenMs: 5_000_000 })
    expect(readClockAnchor()).toEqual(anchor)
  })

  it('BA11 — the written file names itself so a future reader can tell what it is', () => {
    recordLaunch(1_000_000)

    const raw = JSON.parse(readFileSync(clockAnchorPath(), 'utf-8'))

    expect(raw.kind).toBe('strixgeo.beta-anchor')
    expect(raw.format_version).toBe(1)
  })
})

describe('the store refuses to guess where it lives', () => {
  it('BA12 — reading before configuration throws rather than writing somewhere random', () => {
    resetBetaExpiryStoreForTests()

    expect(() => clockAnchorPath()).toThrow(/configureBetaExpiryStore/)
  })
})
