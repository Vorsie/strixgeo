/**
 * Where the expiry date comes from, and who is allowed to set it.
 *
 * The rule: a PACKAGED build takes its expiry only from what was compiled into
 * it. An environment variable may drive the date in dev (so the expiry flow can
 * be rehearsed without a rebuild) and must be ignored once packaged — otherwise
 * the "waterproof" expiry is a `set STRIX_BETA_EXPIRES_AT=2099-01-01` away from
 * useless.
 */

import { describe, expect, it } from 'vitest'

import { buildDisplayInfo, parseBuildStamp, readBuildStamp } from './buildStamp'

describe('parsing the compiled-in stamp', () => {
  it('BS1 — a complete stamp parses to epoch milliseconds', () => {
    const stamp = parseBuildStamp({
      buildId: '2026.08.26-beta',
      builtAt: '2026-08-26T00:00:00.000Z',
      expiresAt: '2026-10-10T00:00:00.000Z',
    })

    expect(stamp).toEqual({
      buildId: '2026.08.26-beta',
      builtAtMs: Date.UTC(2026, 7, 26),
      expiresAtMs: Date.UTC(2026, 9, 10),
    })
  })

  it('BS2 — no stamp at all parses to nothing', () => {
    expect(parseBuildStamp({})).toBeNull()
  })

  it('BS3 — a stamp missing its expiry parses to nothing', () => {
    expect(parseBuildStamp({ buildId: 'x', builtAt: '2026-08-26T00:00:00.000Z' })).toBeNull()
  })

  it('BS4 — an unreadable date parses to nothing rather than to NaN', () => {
    expect(
      parseBuildStamp({
        buildId: 'x',
        builtAt: 'the day before yesterday',
        expiresAt: '2026-10-10T00:00:00.000Z',
      }),
    ).toBeNull()
  })

  it('BS5 — an expiry that precedes the build date parses to nothing', () => {
    expect(
      parseBuildStamp({
        buildId: 'x',
        builtAt: '2026-10-10T00:00:00.000Z',
        expiresAt: '2026-08-26T00:00:00.000Z',
      }),
    ).toBeNull()
  })

  it('BS6 — a stamp with no build id still parses, named for its date', () => {
    const stamp = parseBuildStamp({
      builtAt: '2026-08-26T00:00:00.000Z',
      expiresAt: '2026-10-10T00:00:00.000Z',
    })

    expect(stamp?.buildId).toBe('2026-08-26T00:00:00.000Z')
  })
})

describe('who may set the expiry', () => {
  const env = {
    STRIX_BETA_BUILD_ID: 'env-build',
    STRIX_BETA_BUILT_AT: '2026-08-26T00:00:00.000Z',
    STRIX_BETA_EXPIRES_AT: '2026-10-10T00:00:00.000Z',
  }

  it('BS7 — in dev the environment may drive the date so the flow can be rehearsed', () => {
    const stamp = readBuildStamp({ isPackaged: false, env })

    expect(stamp?.buildId).toBe('env-build')
  })

  it('BS8 — a packaged build ignores the environment entirely', () => {
    // The whole point: `set STRIX_BETA_EXPIRES_AT=2099-01-01` must not extend
    // a shipped beta.
    const stamp = readBuildStamp({ isPackaged: true, env })

    expect(stamp).toBeNull()
  })

  it('BS9 — a packaged build with a compiled-in stamp uses it', () => {
    const stamp = readBuildStamp({
      isPackaged: true,
      env,
      compiled: {
        buildId: 'compiled-build',
        builtAt: '2026-08-26T00:00:00.000Z',
        expiresAt: '2026-10-10T00:00:00.000Z',
      },
    })

    expect(stamp?.buildId).toBe('compiled-build')
  })

  it('BS10 — the compiled stamp outranks the environment in dev too', () => {
    const stamp = readBuildStamp({
      isPackaged: false,
      env,
      compiled: {
        buildId: 'compiled-build',
        builtAt: '2026-08-26T00:00:00.000Z',
        expiresAt: '2026-10-10T00:00:00.000Z',
      },
    })

    expect(stamp?.buildId).toBe('compiled-build')
  })

  it('BS11 — no stamp anywhere means the build never expires', () => {
    expect(readBuildStamp({ isPackaged: true, env: {} })).toBeNull()
  })
})

// Owner finding (f): Help → Licence must show, in one block, the licence key's
// own expiry AND the build's beta expiry stamp WITH the git SHA
// ("Beta build 60e282c4, expires 1 November 2026"). buildDisplayInfo assembles
// the renderer-safe facts from the same two sources the main process already
// reads — the compiled provenance (SHA) and the parsed beta stamp (expiry).
describe('buildDisplayInfo — the build facts the licence dialog shows', () => {
  const stamp = {
    buildId: '2026.08.26-beta',
    builtAtMs: Date.UTC(2026, 7, 26),
    expiresAtMs: Date.UTC(2026, 10, 1),
  }

  it('BD1 — carries the short git SHA and the beta expiry instant', () => {
    const info = buildDisplayInfo({
      provenance: { sha: '60e282c45abc0000deadbeef', builtAt: '2026-08-26T00:00:00.000Z' },
      stamp,
    })
    // The short SHA matches the owner's "60e282c4" form (8 hex chars).
    expect(info.sha).toBe('60e282c4')
    expect(info.shaFull).toBe('60e282c45abc0000deadbeef')
    expect(info.expiresAtMs).toBe(Date.UTC(2026, 10, 1))
    expect(info.buildId).toBe('2026.08.26-beta')
  })

  it('BD2 — a dev build (no provenance, no stamp) has null SHA and null expiry', () => {
    const info = buildDisplayInfo({ provenance: undefined, stamp: null })
    expect(info.sha).toBeNull()
    expect(info.shaFull).toBeNull()
    expect(info.expiresAtMs).toBeNull()
    expect(info.buildId).toBeNull()
  })

  it('BD3 — a stamp with no provenance still reports the expiry', () => {
    // A build could carry the beta stamp but a mis-injected SHA; the expiry
    // must still surface (the SHA line then reads "—").
    const info = buildDisplayInfo({ provenance: undefined, stamp })
    expect(info.sha).toBeNull()
    expect(info.expiresAtMs).toBe(Date.UTC(2026, 10, 1))
  })
})
