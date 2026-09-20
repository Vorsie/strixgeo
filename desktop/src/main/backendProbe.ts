/**
 * How the main process probes ``:8765`` for a backend it is allowed to adopt
 * (H3(b)).
 *
 * The readiness probe (in ``api:ready`` and in the backend-exit adoption check)
 * decides whether a listener on the API port is OURS. In dev and e2e any
 * listener is fine — the backend is hand-started and the harness owns the port,
 * and the token machinery is not even active there. In a PACKAGED build it is
 * not: an orphaned uvicorn from a crashed previous launch still holds the port
 * with a DIFFERENT per-launch token, and adopting it makes every real request
 * 403 forever.
 *
 * So a packaged probe carries this launch's token AND an ``Origin: null`` — the
 * only request shape ``LocalClientTokenMiddleware`` guards. Our own backend was
 * given the same token in its environment and answers 2xx; a foreign backend
 * compares our token against ITS expected value, mismatches, and answers 403.
 * That 403 is the signal "this is not our backend — do not adopt it".
 *
 * Pure and Electron-free so both branches are unit-testable.
 *
 * @module main/backendProbe
 */

import { LOCAL_CLIENT_TOKEN_HEADER } from './localClientToken'

/** The one origin value ``LocalClientTokenMiddleware`` requires the token with. */
const NULL_ORIGIN = 'null'

/**
 * The headers the readiness probe should send.
 *
 * Parameters
 * ----------
 * packaged : boolean
 *     ``app.isPackaged``.
 * token : string
 *     This launch's local-client token.
 *
 * Returns
 * -------
 * Record<string, string>
 *     ``{ Origin: 'null', <token header>: token }`` when packaged; ``{}`` in dev
 *     (where the token guard is inactive and any listener is adopted).
 */
export function backendProbeHeaders(packaged: boolean, token: string): Record<string, string> {
  if (!packaged) return {}
  return { Origin: NULL_ORIGIN, [LOCAL_CLIENT_TOKEN_HEADER]: token }
}

/** What the probe found on the port. */
export type ProbeVerdict = 'reachable' | 'foreign' | 'unreachable'

/**
 * Classify a probe's HTTP status.
 *
 * Parameters
 * ----------
 * packaged : boolean
 *     ``app.isPackaged`` — a 403 only means "foreign backend" when the token
 *     guard is active, i.e. in a packaged build.
 * status : number
 *     The HTTP status the probe received.
 *
 * Returns
 * -------
 * ProbeVerdict
 *     ``'reachable'`` for a 2xx; ``'foreign'`` for a packaged 403; otherwise
 *     ``'unreachable'``.
 */
export function classifyBackendProbe(packaged: boolean, status: number): ProbeVerdict {
  if (status >= 200 && status < 300) return 'reachable'
  if (packaged && status === 403) return 'foreign'
  return 'unreachable'
}

/** Poll interval of the readiness loop in ``api:ready`` (ms). */
export const BACKEND_READY_POLL_MS = 500

/** A readiness wait either succeeds, fails, or needs another long-start window. */
export type BackendReadyResult = true | false | 'still-starting'

/**
 * How long the app waits for the engine to answer its readiness probe.
 *
 * A packaged FIRST launch is slow: the compiled modules load from a freshly
 * installed tree that Defender scans on first read, the DOV parse pool spawns
 * its workers, and Postgres has just been created — installer #5 needed 33 s
 * on the owner's machine and the old 30 s deadline declared it dead. Three
 * minutes covers a slow laptop; the crash bail in the loop still returns early
 * when the process dies. Dev restarts keep the short deadline.
 */
export function backendReadyDeadlineMs(packaged: boolean): number {
  return packaged ? 180_000 : 30_000
}

/** Number of ``BACKEND_READY_POLL_MS`` attempts that cover the deadline. */
export function backendReadyAttempts(packaged: boolean): number {
  return Math.ceil(backendReadyDeadlineMs(packaged) / BACKEND_READY_POLL_MS)
}

/**
 * Classify a readiness deadline without calling a slow but alive child failed.
 *
 * A packaged first launch can spend longer than the initial budget loading
 * Defender-scanned compiled dependencies. The renderer must keep polling that
 * child, while an exited child is an actual failed startup.
 */
export function readinessDeadlineResult(processIsAlive: boolean): BackendReadyResult {
  return processIsAlive ? 'still-starting' : false
}
