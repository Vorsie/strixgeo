// H3(a) — a backend that dies AFTER it became ready is respawned ONCE, with a
// short backoff. A second death within a minute is a crash loop, not a blip, so
// the app gives up to the existing failure banner instead of respawning forever.

import { describe, expect, it } from 'vitest'

import { decideBackendRespawn, BACKEND_RESPAWN_GUARD_MS } from './backendRespawnPolicy'

describe('decideBackendRespawn', () => {
  it('respawns on the first exit-after-ready (no prior respawn this session)', () => {
    expect(decideBackendRespawn(null, 10_000, BACKEND_RESPAWN_GUARD_MS)).toBe('respawn')
  })

  it('gives up on a second death inside the guard window (a crash loop)', () => {
    // Respawned at t=1000; it died again 500 ms later.
    expect(decideBackendRespawn(1_000, 1_500, BACKEND_RESPAWN_GUARD_MS)).toBe('give-up')
  })

  it('respawns again once the guard window has fully elapsed (a genuine recovery)', () => {
    // Respawned at t=1000; the next death is well over a minute later.
    expect(decideBackendRespawn(1_000, 1_000 + BACKEND_RESPAWN_GUARD_MS + 1, BACKEND_RESPAWN_GUARD_MS)).toBe(
      'respawn',
    )
  })

  it('treats the exact guard boundary as elapsed (respawn)', () => {
    expect(decideBackendRespawn(1_000, 1_000 + BACKEND_RESPAWN_GUARD_MS, BACKEND_RESPAWN_GUARD_MS)).toBe(
      'respawn',
    )
  })

  it('the guard window is a minute', () => {
    expect(BACKEND_RESPAWN_GUARD_MS).toBe(60_000)
  })
})
