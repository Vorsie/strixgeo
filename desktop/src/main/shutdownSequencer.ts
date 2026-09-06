/**
 * The deterministic app-quit sequence: stop the children, hard deadline, exit.
 *
 * The owner's rule (2026-09-06): every time StrixGeo closes, the whole process
 * tree must be gone within a couple of seconds - the Electron process and its
 * helpers, the Python engine (uvicorn plus its ``ProcessPoolExecutor`` parse
 * workers and the heavy-library warm-up thread), and the embedded PostgreSQL
 * cluster. Before this, the quit teardown ran ``pg_ctl stop -m fast -w -t 30``,
 * a blocking wait of up to THIRTY seconds on the main thread, so a freshly
 * closed StrixGeo lingered in Task Manager and the NSIS installer's
 * ``CHECK_APP_RUNNING`` refused to reinstall over it.
 *
 * The sequence itself lives here, as a pure function driven by injected effects,
 * so its ORDER and its hard deadline are testable without spawning a process:
 *
 *   1. Kill the engine's whole process tree FIRST - always by tree, never a bare
 *      ``child.kill()`` (which orphans the parse-pool grandchildren on Windows).
 *      First, so its dropped database connections let PostgreSQL checkpoint fast.
 *   2. Graceful quit: ask PostgreSQL to stop with a clean fast checkpoint,
 *      bounded by the 2s hard deadline. A clean stop means no WAL replay on the
 *      next boot (which the owner also cares about - cold boot is already slow).
 *      If it does not stop in time, force its process tree down.
 *   3. Crash quit: no time for a checkpoint - force both trees down at once.
 *
 * The caller wires the terminal ``app.exit(0)`` / ``process.exit(1)`` around this
 * (platform policy: macOS keeps the app alive after its last window closes), and
 * supplies the real effects - see ``index.ts``.
 *
 * @module main/shutdownSequencer
 */

/** How long PostgreSQL gets to stop cleanly before its tree is force-killed. */
export const SHUTDOWN_DEADLINE_MS = 2000

/** Which quit this is: a normal close, or a main-process crash. */
export type ShutdownMode = 'graceful' | 'crash'

/** The side effects {@link performShutdown} drives. Injected so the sequence is testable. */
export interface ShutdownIo {
  /**
   * Force-kill the engine child's whole process tree (``taskkill /PID <pid> /T
   * /F``), reaching the parse-pool grandchildren a bare ``child.kill()`` would
   * orphan. No-op when no engine is running.
   */
  killEngineTree: () => void
  /**
   * Ask PostgreSQL to stop with a fast checkpoint, waiting at most ``graceMs``.
   * Returns true when it confirmed stopped (a clean shutdown, no crash-recovery
   * next boot), false when it did not stop in time. No-op returning true when no
   * embedded cluster is running (dev / e2e, where Docker owns the database).
   */
  stopPostgresClean: (graceMs: number) => boolean
  /**
   * Force PostgreSQL's whole process tree down - the fallback when the clean
   * stop did not finish, and the only path on a crash. Idempotent; a no-op when
   * nothing is running.
   */
  killPostgresTree: () => void
  /** INFO log sink, receiving one line per step with elapsed timing. */
  log: (line: string) => void
  /** Monotonic clock in milliseconds, for the timing in the log lines. */
  now: () => number
}

/**
 * Run the quit sequence: kill the engine tree, then stop the database (cleanly
 * within the deadline on a graceful quit, forcibly on a crash).
 *
 * Does NOT exit the process - the caller does that after this returns, so the
 * macOS "app outlives its last window" policy stays in the caller.
 *
 * Parameters
 * ----------
 * io : ShutdownIo
 *     The injected effects.
 * mode : ShutdownMode
 *     ``'graceful'`` gives PostgreSQL the 2s clean-stop window; ``'crash'``
 *     skips it and force-kills both trees immediately.
 */
export function performShutdown(io: ShutdownIo, mode: ShutdownMode): void {
  const started = io.now()
  io.log(`[shutdown] begin (${mode}) - hard deadline ${SHUTDOWN_DEADLINE_MS}ms`)

  // Engine first, always by tree: on Windows child.kill() is TerminateProcess on
  // the direct process only, leaving the ProcessPoolExecutor parse workers
  // orphaned. Doing it first drops its DB connections so Postgres can checkpoint.
  io.killEngineTree()
  io.log(`[shutdown] engine tree killed (+${io.now() - started}ms)`)

  if (mode === 'graceful' && io.stopPostgresClean(SHUTDOWN_DEADLINE_MS)) {
    io.log(`[shutdown] postgres stopped cleanly (+${io.now() - started}ms)`)
    return
  }

  if (mode === 'graceful') {
    io.log(`[shutdown] postgres did not stop within ${SHUTDOWN_DEADLINE_MS}ms - forcing its tree`)
  }
  io.killPostgresTree()
  io.log(`[shutdown] postgres tree killed (+${io.now() - started}ms)`)
}
