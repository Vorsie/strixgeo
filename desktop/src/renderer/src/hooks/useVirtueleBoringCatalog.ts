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
// Invalidated only on page reload (closing the desktop app) — DOV's
// catalogue doesn't churn within a session.
//
// Deliberately NOT built on hooks/createCatalogHook.ts (audit
// FE-HOOKS-08): this variant's delta is most of the body — an
// ``enabled`` defer-the-fetch gate, retry on the next enable after an
// error (inflight cleared on rejection), and an explicit failure flag
// so the picker can SAY "DOV layer models unavailable" instead of just
// greying out silently (owner dogfeed 2026-09-05).

import { useEffect, useState } from 'react'

import { ApiError, api } from '../api/client'
import type { VirtueleBoringLagenmodelEntry } from '../api/client'
import { log } from '../utils/log'

let cachedCatalog: VirtueleBoringLagenmodelEntry[] | null = null
let inflight: Promise<VirtueleBoringLagenmodelEntry[]> | null = null

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
  const [failed, setFailed] = useState(false)
  const [status, setStatus] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (cachedCatalog !== null) {
      // Already cached from a previous mount — sync local state.
      if (catalog === null) setCatalog(cachedCatalog)
      return
    }
    let cancelled = false
    const promise =
      inflight ??
      (inflight = api.virtueleBoring.lagenmodellen().then(
        result => {
          cachedCatalog = result
          inflight = null
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
        log.warn('useVirtueleBoringCatalog', `fetch failed: ${String(err)}`)
        if (cancelled) return
        // Surface the failure so the caller renders a "DOV unavailable"
        // hint. ``catalog`` stays ``null``; a retry happens on the next
        // ``enabled`` flip while the cache is still empty. The HTTP
        // status (e.g. 503 when the backend refuses the DOV host) is
        // carried through when the rejection is a typed ``ApiError``.
        setFailed(true)
        setStatus(err instanceof ApiError ? err.status : null)
      },
    )
    return () => {
      cancelled = true
    }
  }, [enabled, catalog])

  return { catalog, failed, status }
}
