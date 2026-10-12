// H3(a) — a backend that dies AFTER it became ready is respawned ONCE, with a
// short backoff. A second death within a minute is a crash loop, not a blip, so
// the app gives up to the existing failure banner instead of respawning forever.

import { describe, expect, it } from 'vitest'

import {
  BACKEND_RESPAWN_GUARD_MS,
  decideBackendRespawn,
  decideExitAfterReady,
  decideExitBeforeReady,
} from './backendRespawnPolicy'

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

  it('measures the window from the respawn becoming READY, so a slow bind that dies at once is a crash loop', () => {
    // A packaged respawn can spend most of its 3-minute readiness window
    // binding. Counted from the SPAWN, a child ready at +70 s and dead at +75 s
    // would read as a recovery (75 s > 60 s) and be respawned forever. The
    // stamp the caller hands in is the READY moment, so this is 5 s: give up.
    const readyAt = 1_000_000
    expect(decideBackendRespawn(readyAt, readyAt + 5_000, BACKEND_RESPAWN_GUARD_MS)).toBe('give-up')
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

// Tester finding 2026-10-12: in a PACKAGED app the engine is OUR child on a port
// this launch chose. When that child exits, a listener still answering on the
// port is somebody else's program, never our backend: a packaged app never
// adopts it. Dev and e2e keep adopting (the hand-started uvicorn, the harness).
describe('packaged: never adopt a foreign listener on the engine port', () => {
  it('RP1 - exit before ready, port answers, packaged: fail, do not adopt', () => {
    expect(decideExitBeforeReady(true, 'reachable')).toBe('fail')
  })

  it('RP2 - exit before ready, port answers, dev: adopt (external backend)', () => {
    expect(decideExitBeforeReady(false, 'reachable')).toBe('adopt')
  })

  it('RP3 - exit before ready, port silent or foreign: fail in both builds', () => {
    expect(decideExitBeforeReady(true, 'unreachable')).toBe('fail')
    expect(decideExitBeforeReady(false, 'unreachable')).toBe('fail')
    expect(decideExitBeforeReady(true, 'foreign')).toBe('fail')
  })

  it('RP4 - exit after ready, port answers, packaged: not ignored (respawn policy applies)', () => {
    expect(decideExitAfterReady('reachable', null, 10_000, BACKEND_RESPAWN_GUARD_MS, true)).toBe('respawn')
    expect(decideExitAfterReady('reachable', 9_800, 10_000, BACKEND_RESPAWN_GUARD_MS, true)).toBe('give-up')
  })
})
