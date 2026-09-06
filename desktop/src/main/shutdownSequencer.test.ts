// The deterministic close, in the owner's words (2026-09-06): "when reinstalling
// it always says the app is still open when it isn't ... kill all lingering
// processes". Every quit must leave the whole tree - Electron, the Python engine
// (uvicorn + its parse-pool grandchildren + the warm-up thread), and the
// embedded PostgreSQL cluster - gone within a couple of seconds, even when a
// child ignores the polite stop.
//
// The sequence lives in a pure module so its ORDER and its hard deadline are
// testable without spawning a real process: the effects (kill the engine tree,
// stop postgres cleanly, force the postgres tree) are injected and recorded.

import { describe, expect, it, vi } from 'vitest'

import { performShutdown, SHUTDOWN_DEADLINE_MS, type ShutdownIo } from './shutdownSequencer'

/** A recording io whose ``stopPostgresClean`` result is scripted per test. */
function fakeIo(postgresStopsCleanly: boolean): {
  io: ShutdownIo
  order: string[]
  cleanGraceMs: number[]
} {
  const order: string[] = []
  const cleanGraceMs: number[] = []
  const io: ShutdownIo = {
    killEngineTree: vi.fn(() => order.push('kill-engine-tree')),
    stopPostgresClean: vi.fn((graceMs: number) => {
      cleanGraceMs.push(graceMs)
      order.push('stop-postgres-clean')
      return postgresStopsCleanly
    }),
    killPostgresTree: vi.fn(() => order.push('kill-postgres-tree')),
    log: () => {},
    now: () => 0,
  }
  return { io, order, cleanGraceMs }
}

describe('closing the app kills every lingering process within two seconds', () => {
  it('SS1 - even when the database does not stop on its own, its tree is force-killed', () => {
    // The database ignores the polite ``pg_ctl stop`` (returns "did not stop").
    const { io, order, cleanGraceMs } = fakeIo(false)

    performShutdown(io, 'graceful')

    // The clean attempt is bounded by the 2s hard deadline...
    expect(cleanGraceMs).toEqual([SHUTDOWN_DEADLINE_MS])
    expect(SHUTDOWN_DEADLINE_MS).toBe(2000)
    // ...and when it does not stop, the postgres tree is force-killed.
    expect(io.killEngineTree).toHaveBeenCalledTimes(1)
    expect(io.killPostgresTree).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['kill-engine-tree', 'stop-postgres-clean', 'kill-postgres-tree'])
  })

  it('SS2 - a child that ignores the polite stop is killed by its process tree', () => {
    const { io } = fakeIo(false)

    performShutdown(io, 'graceful')

    // The engine is ALWAYS taken by its tree (never a bare child.kill), and a
    // postgres that will not go politely is taken by its tree too.
    expect(io.killEngineTree).toHaveBeenCalledTimes(1)
    expect(io.killPostgresTree).toHaveBeenCalledTimes(1)
  })

  it('SS3 - a database that stops on its own is left cleanly stopped, not force-killed', () => {
    // A clean fast checkpoint means no crash-recovery WAL replay on next boot.
    const { io } = fakeIo(true)

    performShutdown(io, 'graceful')

    expect(io.killEngineTree).toHaveBeenCalledTimes(1)
    expect(io.stopPostgresClean).toHaveBeenCalledTimes(1)
    expect(io.killPostgresTree).not.toHaveBeenCalled()
  })

  it('SS4 - a crash exit still kills the children, skipping the polite wait', () => {
    const { io, order } = fakeIo(true)

    performShutdown(io, 'crash')

    // No time for a graceful checkpoint on a crash - both trees go down at once.
    expect(io.killEngineTree).toHaveBeenCalledTimes(1)
    expect(io.killPostgresTree).toHaveBeenCalledTimes(1)
    expect(io.stopPostgresClean).not.toHaveBeenCalled()
    expect(order).toEqual(['kill-engine-tree', 'kill-postgres-tree'])
  })
})
