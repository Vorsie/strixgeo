/**
 * Whether to respawn the backend after it dies mid-session (H3(a)).
 *
 * A backend that exits AFTER it became ready used to be ignored — the app stayed
 * open talking to a dead API, with no retry. One respawn recovers the common
 * case (a one-off crash, an OOM-killed worker); a second death in quick
 * succession is a crash loop, and respawning into it forever is worse than
 * stopping. So: respawn once, and if it dies again inside the guard window, give
 * up to the existing backend-failed banner.
 *
 * Pure and Electron-free; the caller tracks the timestamp and performs the spawn.
 *
 * @module main/backendRespawnPolicy
 */

/**
 * How long after a respawn a fresh death still counts as the SAME crash loop.
 *
 * A minute: long enough that a backend which came up, served for a while, then
 * died again is treated as a new fault worth one more respawn — but short enough
 * that an immediate re-crash is caught and stopped.
 */
export const BACKEND_RESPAWN_GUARD_MS = 60_000

/** What to do about a backend exit that happened after readiness. */
export type BackendExitAction = 'respawn' | 'give-up'

/**
 * Decide whether to respawn the backend.
 *
 * Parameters
 * ----------
 * lastRespawnAtMs : number | null
 *     When the backend was last respawned this session, or ``null`` if it never
 *     has been.
 * nowMs : number
 *     The current time.
 * guardWindowMs : number
 *     The crash-loop window; a death within this of the last respawn gives up.
 *
 * Returns
 * -------
 * BackendExitAction
 *     ``'respawn'`` for the first death, or one after the window elapsed;
 *     ``'give-up'`` for a death still inside the window.
 */
export function decideBackendRespawn(
  lastRespawnAtMs: number | null,
  nowMs: number,
  guardWindowMs: number,
): BackendExitAction {
  if (lastRespawnAtMs !== null && nowMs - lastRespawnAtMs < guardWindowMs) {
    return 'give-up'
  }
  return 'respawn'
}
