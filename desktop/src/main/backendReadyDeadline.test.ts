// Rule (owner, installer #5 on 2026-09-03): a packaged first launch may take
// well over 30 s to bring the engine up (compiled modules loading from a fresh
// install under Defender, the DOV parse pool, Postgres already running), and
// the app must keep waiting instead of declaring the engine dead at 30 s. Dev
// restarts stay snappy.
import { describe, expect, it } from 'vitest'

import {
  backendReadyDeadlineMs,
  backendReadyAttempts,
  BACKEND_READY_POLL_MS,
  readinessDeadlineResult,
  BACKEND_READY_MAX_WINDOWS,
  pollBackendUntilReady,
  type ProbeVerdict,
} from './backendProbe'

describe('backendReadyDeadlineMs', () => {
  it('a packaged app waits at least three minutes for a cold engine', () => {
    expect(backendReadyDeadlineMs(true)).toBeGreaterThanOrEqual(180_000)
  })

  it('a dev app keeps the short 30 s deadline', () => {
    expect(backendReadyDeadlineMs(false)).toBe(30_000)
  })

  it('the attempt count covers the deadline at the poll interval', () => {
    expect(backendReadyAttempts(true) * BACKEND_READY_POLL_MS).toBeGreaterThanOrEqual(backendReadyDeadlineMs(true))
    expect(backendReadyAttempts(false) * BACKEND_READY_POLL_MS).toBeGreaterThanOrEqual(backendReadyDeadlineMs(false))
  })

  it('an alive backend stays in the starting state when the initial wait budget expires', () => {
    // A cold packaged engine can outlast the first budget while Defender scans
    // its compiled extensions. That is slow, not a failed launch.
    expect(readinessDeadlineResult(true, 1)).toBe('still-starting')
  })

  it('a backend that has exited by the deadline is a real startup failure', () => {
    expect(readinessDeadlineResult(false, 1)).toBe(false)
  })

  // Rule (owner, 2026-09-20): a cold engine gets a second three-minute window.
  // A backend still not ready after both windows is a real failure, so the app
  // reaches its boot-error screen instead of spinning forever, which is the
  // bad-install case a beta tester hit.
  it('a backend still not ready after the second window is a real failure', () => {
    expect(readinessDeadlineResult(true, BACKEND_READY_MAX_WINDOWS)).toBe(false)
  })

  it('the cold start is allowed exactly two readiness windows', () => {
    expect(BACKEND_READY_MAX_WINDOWS).toBe(2)
    expect(BACKEND_READY_MAX_WINDOWS * backendReadyDeadlineMs(true)).toBe(360_000)
  })
})

// Rule (owner finding 1, 2026-09-20): a mid-session backend RESPAWN must wait
// the same packaged-aware window a first start gets, not the fixed 30 s that a
// hard-coded 60 polls at 500 ms produced. On the machine class this exists for,
// a respawn that needs 40 s used to show the backend-failed modal over a backend
// that was about to come up.
describe('pollBackendUntilReady — a respawn waits its whole packaged window', () => {
  const noSleep = (): Promise<void> => Promise.resolve()

  it('catches a packaged respawn that only binds its port past the old 30 s cap', async () => {
    // The backend answers only on its 90th probe — 45 s at the poll interval,
    // well past the old 60-probe (30 s) cap. With the packaged budget it is
    // still caught instead of being declared dead.
    let probes = 0
    const outcome = await pollBackendUntilReady({
      attempts: backendReadyAttempts(true),
      pollMs: BACKEND_READY_POLL_MS,
      probe: async (): Promise<ProbeVerdict> => (++probes >= 90 ? 'reachable' : 'unreachable'),
      processIsAlive: () => true,
      sleep: noSleep,
    })
    expect(outcome).toBe('ready')
    expect(probes).toBeGreaterThan(60)
  })

  it('gives up once the window is spent when the respawn never binds its port', async () => {
    const outcome = await pollBackendUntilReady({
      attempts: 4,
      pollMs: BACKEND_READY_POLL_MS,
      probe: async (): Promise<ProbeVerdict> => 'unreachable',
      processIsAlive: () => true,
      sleep: noSleep,
    })
    expect(outcome).toBe('failed')
  })

  it('gives up at once when the respawned process dies before it is ready', async () => {
    // A respawn that crashed before binding the port is a failure now, not
    // something to keep polling for the whole three-minute window.
    let probes = 0
    let alive = true
    const outcome = await pollBackendUntilReady({
      attempts: backendReadyAttempts(true),
      pollMs: BACKEND_READY_POLL_MS,
      probe: async (): Promise<ProbeVerdict> => {
        probes += 1
        alive = false
        return 'unreachable'
      },
      processIsAlive: () => alive,
      sleep: noSleep,
    })
    expect(outcome).toBe('failed')
    expect(probes).toBeLessThan(5)
  })
})
