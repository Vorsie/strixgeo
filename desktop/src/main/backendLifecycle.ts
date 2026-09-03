/**
 * When the packaged backend + database are torn down, relative to the quit.
 *
 * The rule (H1, docs/design/autosave-recovery.md §4): **the backend and the
 * database stop only after the renderer has answered the close prompt.** The
 * renderer owns the project's dirty state and runs the save-or-discard prompt
 * inside the window's ``close`` handler; a Save issued there must reach a LIVE
 * API.
 *
 * Electron's quit order is the trap. ``app.quit()`` (File → Quit, Ctrl+Q, the
 * beta watchdog) fires ``before-quit`` FIRST, then the window ``close`` events,
 * then — only if the quit was not vetoed — ``window-all-closed`` and
 * ``will-quit``. Stopping the backend on ``before-quit`` therefore kills it
 * BEFORE the save prompt has even been shown, and if the user then cancels the
 * prompt the backend is dead for the rest of the session too.
 *
 * So the teardown is wired to the events that fire only once every window has
 * actually closed — which is exactly "after the renderer answered":
 *
 *   * ``window-all-closed`` — the normal path (X, or a save/discard that closed
 *     the window). Stops the backend, then lets the caller quit the platform.
 *   * ``will-quit`` — the definitive teardown for any quit that proceeds
 *     (idempotent with the above; ``stopBackend`` guards its own null refs).
 *
 * ``before-quit`` is deliberately left to the caller for concerns that are safe
 * before the prompt (nothing today) — it must never stop the backend.
 *
 * Kept as a pure wiring function so the ORDER is unit-testable with a fake app
 * and a fired event sequence, without importing Electron.
 *
 * @module main/backendLifecycle
 */

/** The slice of Electron's ``app`` this module registers handlers on. */
export interface QuitLifecycleApp {
  on(event: 'before-quit' | 'will-quit' | 'window-all-closed', handler: () => void): void
}

/** The side effects the lifecycle wiring drives. */
export interface BackendLifecycleWiring {
  /**
   * Stop the backend child and the embedded database. Must be idempotent — it
   * is called from both ``window-all-closed`` and ``will-quit`` and a graceful
   * quit fires both.
   */
  stopBackend: () => void
  /**
   * Extra work after the backend is stopped on ``window-all-closed`` — the
   * platform-specific ``app.quit()`` on non-macOS.
   */
  onWindowAllClosed?: () => void
  /**
   * Extra teardown after the backend is stopped on ``will-quit`` — e.g.
   * cancelling the diagnostics uploader's retry timer so it cannot hold the
   * event loop open.
   */
  onWillQuit?: () => void
}

/**
 * Wire the backend/database teardown to the quit lifecycle.
 *
 * Parameters
 * ----------
 * appLike : QuitLifecycleApp
 *     Electron's ``app``, or a test double exposing ``on``.
 * wiring : BackendLifecycleWiring
 *     The teardown callbacks — see {@link BackendLifecycleWiring}.
 */
export function registerBackendLifecycle(
  appLike: QuitLifecycleApp,
  wiring: BackendLifecycleWiring,
): void {
  appLike.on('window-all-closed', () => {
    // Backend first, then the platform quit: stopping the DB client before the
    // server goes away keeps the shutdown free of connection-error log lines.
    wiring.stopBackend()
    wiring.onWindowAllClosed?.()
  })
  appLike.on('will-quit', () => {
    wiring.stopBackend()
    wiring.onWillQuit?.()
  })
  // No ``before-quit`` teardown on purpose: the renderer's save prompt runs
  // AFTER before-quit and BEFORE the window closes, so anything torn down here
  // would be torn down under a live, unsaved session.
}
