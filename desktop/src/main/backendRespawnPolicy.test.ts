// H3(a) — a backend that dies AFTER it became ready is respawned ONCE, with a
// short backoff. A second death within a minute is a crash loop, not a blip, so
// the app gives up to the existing failure banner instead of respawning forever.

import { describe, expect, it } from 'vitest'

import { decideBackendRespawn, decideExitAfterReady, BACKEND_RESPAWN_GUARD_MS } from './backendRespawnPolicy'

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

// Rule (e2e sweep 2026-09-03, 40 UI specs red): an exit AFTER readiness is only a
// crash when the API is actually gone. When :8765 still answers, the process
// that exited was OUR child losing the port race against an external backend
// (the dev session's own uvicorn, the e2e harness) — readiness was confirmed
// against that external backend, so there is nothing to respawn. Respawning
// spawns a second loser, and the crash-loop guard then gives up with the fatal
// modal while the API is alive.
describe('decideExitAfterReady', () => {
  it('ignores an exit while :8765 still answers — an external backend owns the port', () => {
    expect(decideExitAfterReady('reachable', null, 10_000, BACKEND_RESPAWN_GUARD_MS)).toBe('ignore')
    // Even inside the guard window: still alive, still nothing to do.
    expect(decideExitAfterReady('reachable', 9_800, 10_000, BACKEND_RESPAWN_GUARD_MS)).toBe('ignore')
  })

  it('respawns once when the port is unreachable (the backend really died)', () => {
    expect(decideExitAfterReady('unreachable', null, 10_000, BACKEND_RESPAWN_GUARD_MS)).toBe('respawn')
  })

  it('gives up on a second death inside the guard window when the port is unreachable', () => {
    expect(decideExitAfterReady('unreachable', 9_800, 10_000, BACKEND_RESPAWN_GUARD_MS)).toBe('give-up')
  })

  it('treats a foreign backend on the port as dead (packaged: a stale token would 403 forever)', () => {
    expect(decideExitAfterReady('foreign', null, 10_000, BACKEND_RESPAWN_GUARD_MS)).toBe('respawn')
  })
})
