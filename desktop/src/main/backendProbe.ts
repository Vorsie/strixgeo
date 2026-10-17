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
import type { BackendReadyResult } from './backendReadyResult'

// Re-export the shared IPC-result type so ``BackendReadyResult`` stays importable
// from this module, while its single definition lives in the dependency-free
// declaration module the preload and renderer can also reference (item 2).
export type { BackendReadyResult } from './backendReadyResult'

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

/**
 * How long the app waits for the engine to answer its readiness probe.
 *
 * A packaged FIRST launch is slow: the backend source and its native
 * dependencies load from a freshly installed tree that Defender scans on first
 * read, the DOV parse pool spawns
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
 * How many readiness windows a cold start may use before it is a failure.
 *
 * Two windows of ``backendReadyDeadlineMs`` (6 minutes packaged). The bound is
 * the whole point: a backend that is alive but never binds its port (a spawn
 * that failed, a wedged Defender scan) must still reach the boot-error screen
 * with its "Save logs for support" hint, instead of leaving the user on a
 * spinner forever. Owner ruling 2026-09-20, after a beta tester's install.
 */
export const BACKEND_READY_MAX_WINDOWS = 2

/**
 * Classify a readiness deadline without calling a slow but alive child failed.
 *
 * A packaged first launch can spend longer than the initial budget loading
 * Defender-scanned compiled dependencies, so an alive child gets another
 * window. An exited child is an actual failed startup, and so is an alive
 * child that has used every window it is allowed.
 *
 * @param processIsAlive - Whether the engine child process is still running.
 * @param windowsUsed - Readiness windows consumed so far, including this one.
 * @returns ``'still-starting'`` only while a further window remains.
 */
export function readinessDeadlineResult(
  processIsAlive: boolean,
  windowsUsed: number,
): BackendReadyResult {
  if (!processIsAlive) return false
  return windowsUsed < BACKEND_READY_MAX_WINDOWS ? 'still-starting' : false
}

/** Outcome of polling a just-respawned backend to readiness. */
export type BackendReadyPollOutcome = 'ready' | 'failed'

/**
 * Poll a backend to readiness across one deadline window.
 *
 * Pure and Electron-free (its I/O — the probe, the alive check, the sleep — is
 * injected) so the wait duration is unit-testable, mirroring the rest of this
 * module. It is used by the mid-session RESPAWN path (``awaitRespawnedBackendReady``
 * in index.ts), which must wait the same packaged-aware window as a first start
 * (``attempts = backendReadyAttempts(app.isPackaged)`` at ``BACKEND_READY_POLL_MS``)
 * instead of a hard-coded 60 × 500 ms = 30 s cap that declared a slow packaged
 * respawn dead.
 *
 * A respawn gets exactly ONE window, not the cold start's ``BACKEND_READY_MAX_WINDOWS``
 * budget: the second first-start window pays a Defender-scan tax on a freshly
 * installed backend tree that a warm mid-session restart does not pay (the tree
 * was already read and scanned when the session first came up). Hence this
 * returns a plain ready/failed, not the windowed ``BackendReadyResult`` the
 * first-start ``api:ready`` handler produces.
 *
 * @param deps.attempts - How many probes the window allows (one deadline's worth).
 * @param deps.pollMs - Wait between probes.
 * @param deps.probe - Probe the port once; ``'reachable'`` means ready.
 * @param deps.processIsAlive - Whether the respawned child is still running; a
 *   process that vanished before binding the port is a failure, checked before
 *   each probe after the first so a crashed respawn ends at once.
 * @param deps.sleep - Wait ``pollMs`` between probes (a seam for tests).
 * @returns ``'ready'`` once the probe reports reachable; ``'failed'`` if the
 *   window is spent or the child died before it was ready.
 */
export async function pollBackendUntilReady(deps: {
  attempts: number
  pollMs: number
  probe: () => Promise<ProbeVerdict>
  processIsAlive: () => boolean
  sleep: (ms: number) => Promise<void>
}): Promise<BackendReadyPollOutcome> {
  const { attempts, pollMs, probe, processIsAlive, sleep } = deps
  for (let i = 0; i < attempts; i++) {
    // A vanished process after the first probe means the respawn crashed before
    // binding its port — a failure, not something to keep polling the window for.
    if (i > 0 && !processIsAlive()) return 'failed'
    if ((await probe()) === 'reachable') return 'ready'
    await sleep(pollMs)
  }
  return 'failed'
}
