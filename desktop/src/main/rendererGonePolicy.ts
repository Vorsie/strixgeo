/**
 * Whether to reload the window after the renderer process dies (H3(d)).
 *
 * A renderer crash used to leave a white window with no way back in a packaged
 * build (View → Reload and Ctrl+R are gone there). Reloading it once recreates
 * the renderer so the crash-recovery offer on the fresh document can take over.
 * Two guards keep that from becoming a spin:
 *
 *   * A DELIBERATE teardown is left alone. ``killed`` is what Electron reports
 *     while the app is quitting (or an e2e harness kills the renderer), and
 *     ``clean-exit`` is a normal shutdown — reloading either fights a teardown
 *     that is meant to happen.
 *   * The reload happens ONCE. The caller clears the guard only when a document
 *     finishes loading, so a crash that recurs before recovery does not loop.
 *
 * Pure and Electron-free; the caller owns the guard flag and performs the reload.
 *
 * @module main/rendererGonePolicy
 */

/**
 * ``render-process-gone`` reasons that are a deliberate teardown, not a fault.
 *
 * Electron's reason strings; see ``RenderProcessGoneDetails.reason``.
 */
const DELIBERATE_EXIT_REASONS = new Set(['killed', 'clean-exit'])

/**
 * Should the window be reloaded after ``render-process-gone``?
 *
 * Parameters
 * ----------
 * reason : string
 *     Electron's ``details.reason`` (``crashed`` / ``oom`` / ``killed`` /
 *     ``clean-exit`` / ``launch-failed`` / ``integrity-failure`` / ...).
 * alreadyReloaded : boolean
 *     Whether the window has already been reloaded since the last successful
 *     load — the anti-loop guard.
 *
 * Returns
 * -------
 * boolean
 *     True only for a genuine fault that has not already been reloaded.
 */
export function shouldReloadRendererAfterGone(reason: string, alreadyReloaded: boolean): boolean {
  if (alreadyReloaded) return false
  return !DELIBERATE_EXIT_REASONS.has(reason)
}
