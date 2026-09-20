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
