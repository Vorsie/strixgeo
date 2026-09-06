// Session-scoped cache for the DOV Virtuele Boring lagenmodel
// catalogue. Three components need the 12-entry list (the section
// pane's strip + the CPT chart and borelog overlay dropdowns); all
// of them share a single fetch.
//
// Why a module-level Promise instead of React state-only: the fetch
// is fire-and-forget from each consumer, but only ONE network call
// should happen per session. A module-level cache survives every
// component unmount/remount. Concurrent first-mounts share the
// inflight Promise so two parallel openings don't fire two fetches.
// The success cache is invalidated only on page reload (closing the
// desktop app): DOV's catalogue doesn't churn within a session.
//
// A FAILURE is session-cached too (``lastFailure``). The catalogue is a
// proxy to an external DOV host, and an unreachable host is a degraded
// state, not a per-open error: without this, every subsequent CPT /
// borehole open re-fired the fetch and logged another 502 (walker
// findings 1-9, 2026-09-06: nine identical 502s in one 300-step
// session). After a failure the picker keeps saying "DOV layer models
// unavailable" WITHOUT re-asking, retrying at most once every
// RETRY_INTERVAL_MS in case DOV recovers within a long session. The
// degraded state is logged once at WARN by the transport (clients/shared
// ``DEGRADABLE_GET_PATHS``), so the hook itself does not log.
//
// Deliberately NOT built on hooks/createCatalogHook.ts (audit
// FE-HOOKS-08): this variant's delta is most of the body: an
// ``enabled`` defer-the-fetch gate, the session negative cache with a
// timed retry, and an explicit failure flag + status so the picker can
// SAY "DOV layer models unavailable (502)" instead of greying out
// silently (owner dogfeed 2026-09-05).

import { useEffect, useState } from 'react'

import { ApiError, api } from '../api/client'
import type { VirtueleBoringLagenmodelEntry } from '../api/client'

// Session negative-cache retry interval. After the DOV host is unreachable we
// re-ask at most once every 10 minutes, in case DOV recovers mid-session.
const RETRY_INTERVAL_MS = 10 * 60 * 1000

let cachedCatalog: VirtueleBoringLagenmodelEntry[] | null = null
let inflight: Promise<VirtueleBoringLagenmodelEntry[]> | null = null
// Remembered failure: its wall-clock time + the HTTP status. Non-null blocks
// a refetch until RETRY_INTERVAL_MS has elapsed (see the effect below).
let lastFailure: { at: number; status: number | null } | null = null

/**
 * State returned by :func:`useVirtueleBoringCatalog`.
 *
 * ``catalog`` is ``null`` both while loading and after a failed fetch;
 * ``failed`` disambiguates the two so the caller can render an error
 * line instead of an indefinite disabled control.
 */
export interface VirtueleBoringCatalogState {
  /** The catalogue entries, or ``null`` while loading or after a failure. */
  catalog: VirtueleBoringLagenmodelEntry[] | null
  /** ``true`` when the most recent fetch attempt failed (e.g. the DOV host was refused, 503). */
  failed: boolean
  /** HTTP status of the failed fetch when known (``ApiError.status``), else ``null``. */
  status: number | null
}

/**
 * Hook returns the catalog when available (``catalog``), a ``failed``
 * flag, and the HTTP ``status`` of a failed fetch. While loading and
 * after a failure ``catalog`` is ``null``; ``failed`` tells the two
 * apart so the picker can show "DOV layer models unavailable" rather
 * than an unexplained greyed-out control.
 *
 * Pass ``enabled=false`` to defer the fetch until the user actually
 * opens a picker — most session flows never need the catalogue
 * (engineers leaving DOV overlays off).
 */
export function useVirtueleBoringCatalog(enabled: boolean): VirtueleBoringCatalogState {
  const [catalog, setCatalog] = useState<VirtueleBoringLagenmodelEntry[] | null>(
    cachedCatalog,
  )
  // Reflect a session-remembered failure on first render so a picker opened
  // after an earlier failure shows "unavailable" without a fetch flicker.
  const [failed, setFailed] = useState(lastFailure !== null)
  const [status, setStatus] = useState<number | null>(lastFailure?.status ?? null)

  useEffect(() => {
    if (!enabled) return
    if (cachedCatalog !== null) {
      // Already cached from a previous mount — sync local state.
      if (catalog === null) setCatalog(cachedCatalog)
      return
    }
    // A recent failure short-circuits the fetch: the DOV catalogue was
    // unreachable and we do NOT re-ask on every subsequent picker open. We
    // retry only once RETRY_INTERVAL_MS has elapsed (DOV may recover within a
    // long session). The picker keeps its "DOV layer models unavailable" hint.
    if (lastFailure !== null && Date.now() - lastFailure.at < RETRY_INTERVAL_MS) {
      setFailed(true)
      setStatus(lastFailure.status)
      return
    }
    let cancelled = false
    const promise =
      inflight ??
      (inflight = api.virtueleBoring.lagenmodellen().then(
        result => {
          cachedCatalog = result
          inflight = null
          lastFailure = null
          return result
        },
        err => {
          inflight = null
          throw err
        },
      ))
    void promise.then(
      result => {
        if (cancelled) return
        setCatalog(result)
        setFailed(false)
        setStatus(null)
      },
      err => {
        // Remember the failure for the session so the next picker open does
        // not re-ask. The transport already logged the degraded state at WARN
        // (clients/shared ``DEGRADABLE_GET_PATHS``); the HTTP status (e.g. 502
        // when DOV is unreachable) is carried through on a typed ``ApiError``.
        lastFailure = { at: Date.now(), status: err instanceof ApiError ? err.status : null }
        if (cancelled) return
        setFailed(true)
        setStatus(lastFailure.status)
      },
    )
    return () => {
      cancelled = true
    }
  }, [enabled, catalog])

  return { catalog, failed, status }
}

/**
 * Clear the session catalogue cache, in-flight promise, and remembered
 * failure so a test can drive different fetch responses across runs without
 * module state leaking between them. Test-only: the mirror of
 * ``createCatalogHook``'s ``resetForTesting`` (audit FE-HOOKS-08).
 */
export function resetVirtueleBoringCatalogForTesting(): void {
  cachedCatalog = null
  inflight = null
  lastFailure = null
}
