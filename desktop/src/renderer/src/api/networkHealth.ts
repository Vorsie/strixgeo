/**
 * Backend reachability, tracked across every API call.
 *
 * The app is a desktop shell talking to a Python backend on localhost. When
 * that process dies the shell keeps running, and — before this module — kept
 * looking healthy: every handler caught its own rejection, showed at most a
 * per-action toast, and the engineer went on working into a void. Observed
 * 2026-08-02: an accept loop ran to completion having persisted nothing.
 *
 * What it does NOT do, deliberately:
 *
 * * It does not poll. The signal comes free from the requests the app already
 *   makes; a health-check timer would add a second failure mode to debug.
 * * It does not treat HTTP errors as unreachability. A 409 or a 500 means the
 *   backend answered — the request failed, the connection did not.
 * * It does not retry, queue, or replay anything. Recovering a half-written
 *   session needs the backend's own transactionality, not a renderer-side
 *   guess; the honest answer is to tell the engineer to restart.
 *
 * @module api/networkHealth
 */

/**
 * How many consecutive network-level failures declare the backend gone.
 *
 * One is noise — a single socket dropped while the backend restarts is normal
 * and self-heals on the next call. Three in a row is a state.
 */
export const CONSECUTIVE_NETWORK_FAILURES_BEFORE_UNREACHABLE = 3

/** Consecutive network-level failures since the last success. */
let consecutiveFailures = 0

/** Current condition — mirrors what subscribers were last told. */
let unreachable = false

/** Live subscribers, notified only when `unreachable` actually flips. */
const listeners = new Set<() => void>()

/** Tell every subscriber the condition changed. */
function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * Record a network-level failure — nothing answered.
 *
 * Call ONLY when the transport itself failed (``TypeError: Failed to fetch``),
 * never for a non-2xx response.
 */
export function noteNetworkFailure(): void {
  consecutiveFailures += 1
  if (!unreachable && consecutiveFailures >= CONSECUTIVE_NETWORK_FAILURES_BEFORE_UNREACHABLE) {
    unreachable = true
    notify()
  }
}

/**
 * Record that a request reached the backend and got an answer.
 *
 * Any answer counts, including an HTTP error: the point being measured is
 * whether something is listening, not whether it liked the request.
 */
export function noteNetworkSuccess(): void {
  consecutiveFailures = 0
  if (unreachable) {
    unreachable = false
    notify()
  }
}

/**
 * Whether the backend is currently believed to be unreachable.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` once the consecutive-failure threshold has been crossed and
 *     no request has succeeded since.
 */
export function isBackendUnreachable(): boolean {
  return unreachable
}

/**
 * Subscribe to reachability transitions.
 *
 * Shaped for ``useSyncExternalStore``: the listener takes no arguments and
 * fires only on a real change of state, so a dead-backend storm of failed
 * requests does not re-render the tree once per request.
 *
 * Parameters
 * ----------
 * listener : () => void
 *     Called on every transition, in both directions.
 *
 * Returns
 * -------
 * () => void
 *     Unsubscribe function.
 */
export function subscribeBackendReachability(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Reset counter, condition and subscribers — test seam only.
 *
 * Module state is process-global, so a test that arms the condition would
 * otherwise leak it into the next test file sharing the worker.
 */
export function resetNetworkHealth(): void {
  consecutiveFailures = 0
  unreachable = false
  listeners.clear()
}
