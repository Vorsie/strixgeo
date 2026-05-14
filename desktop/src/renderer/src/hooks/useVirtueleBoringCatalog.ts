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

import { useEffect, useState } from 'react'

import { api } from '../api/client'
import type { VirtueleBoringLagenmodelEntry } from '../api/client'
import { log } from '../utils/log'

let cachedCatalog: VirtueleBoringLagenmodelEntry[] | null = null
let inflight: Promise<VirtueleBoringLagenmodelEntry[]> | null = null

/**
 * Hook returns the catalog when available, or ``null`` while
 * loading / on error. The caller renders the dropdown in a
 * "disabled while loading" state from the ``null`` value.
 *
 * Pass ``enabled=false`` to defer the fetch until the user actually
 * opens a picker — most session flows never need the catalogue
 * (engineers leaving DOV overlays off).
 */
export function useVirtueleBoringCatalog(
  enabled: boolean,
): VirtueleBoringLagenmodelEntry[] | null {
  const [catalog, setCatalog] = useState<VirtueleBoringLagenmodelEntry[] | null>(
    cachedCatalog,
  )

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
        if (!cancelled) setCatalog(result)
      },
      err => {
        log.warning('useVirtueleBoringCatalog', `fetch failed: ${String(err)}`)
        // Leave ``catalog`` at ``null`` so the caller can render a
        // graceful "couldn't reach DOV" hint. A retry happens on the
        // next ``enabled`` flip if the cache is still empty.
      },
    )
    return () => {
      cancelled = true
    }
  }, [enabled, catalog])

  return catalog
}
