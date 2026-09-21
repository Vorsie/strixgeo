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

/** ``BackendExitAction`` plus ``'ignore'`` — the port is still served. */
export type ExitAfterReadyAction = BackendExitAction | 'ignore'

/** The probe verdicts ``decideExitAfterReady`` understands (see backendProbe.ts). */
export type PortVerdict = 'reachable' | 'foreign' | 'unreachable'

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
// ``lastRespawnAtMs`` is the moment the previous respawn became READY, not the
// moment it was spawned. A slow packaged respawn can take up to the full
// readiness window to bind; measured from spawn, a child that bound late and
// died at once would look like a genuine recovery and be respawned forever.
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

/**
 * Decide what a backend exit AFTER readiness means, given a fresh port probe.
 *
 * Readiness is confirmed by probing ``:8765``, not by watching our child — so
 * when an EXTERNAL backend owns the port (the dev session's own uvicorn, the
 * e2e harness), our child loses the bind and exits after the app already
 * marked the backend ready. That exit is not a crash: the API is alive.
 * Respawning would spawn a second loser, and the crash-loop guard would then
 * give up with the fatal modal while every request still succeeds (the e2e
 * sweep of 2026-09-03 lost 40 UI specs to exactly this).
 *
 * Parameters
 * ----------
 * verdict : PortVerdict
 *     The probe of ``:8765`` taken right after the exit: ``'reachable'`` when a
 *     backend still answers 2xx; ``'foreign'`` when a packaged probe was refused
 *     (a stale token — adopting it would 403 forever); ``'unreachable'``
 *     otherwise.
 * lastRespawnAtMs : number | null
 *     When the backend was last respawned this session, or ``null``.
 * nowMs : number
 *     The current time.
 * guardWindowMs : number
 *     The crash-loop window handed to :func:`decideBackendRespawn`.
 *
 * Returns
 * -------
 * ExitAfterReadyAction
 *     ``'ignore'`` while the port still answers; otherwise the respawn policy's
 *     ``'respawn'`` / ``'give-up'``.
 */
export function decideExitAfterReady(
  verdict: PortVerdict,
  lastRespawnAtMs: number | null,
  nowMs: number,
  guardWindowMs: number,
): ExitAfterReadyAction {
  if (verdict === 'reachable') return 'ignore'
  return decideBackendRespawn(lastRespawnAtMs, nowMs, guardWindowMs)
}
