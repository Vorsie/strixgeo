// Rule (owner, installer #5 on 2026-09-03): a packaged first launch may take
// well over 30 s to bring the engine up (compiled modules loading from a fresh
// install under Defender, the DOV parse pool, Postgres already running), and
// the app must keep waiting instead of declaring the engine dead at 30 s. Dev
// restarts stay snappy.
import { describe, expect, it } from 'vitest'

import { backendReadyDeadlineMs, backendReadyAttempts, BACKEND_READY_POLL_MS } from './backendProbe'

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
})
