/**
 * Factory for process-singleton catalog hooks (audit FE-HOOKS-08).
 *
 * ``useG3Dv3Catalog`` and ``useFormalStratigraphyCatalog`` were verbatim
 * copies of the same load-once/share-inflight/cache-forever hook; this
 * factory is the single implementation both instantiate. Behaviour per
 * instance:
 *
 * - First mount kicks a single fetch.
 * - Concurrent first mounts share the in-flight promise (no duplicate
 *   fetches).
 * - A successful fetch populates a factory-scoped cache so subsequent
 *   mounts resolve synchronously.
 * - Failures surface as ``error`` so the caller can degrade gracefully
 *   (a failed fetch is NOT retried — the rejected in-flight promise is
 *   kept, matching the original hooks' semantics; a page reload resets).
 *
 * ``useVirtueleBoringCatalog`` deliberately does NOT use this factory: its
 * delta is most of the body (an ``enabled`` defer-the-fetch gate, retry on
 * the next enable after an error, a bare ``T[] | null`` return shape, and
 * warn-logging instead of an error field).
 */

import { useEffect, useState } from 'react'

/** Snapshot of a catalog hook's state. */
export interface CatalogState<T> {
  units: T[] | null
  loading: boolean
  error: Error | null
}

/**
 * Build a process-singleton catalog hook around ``fetchUnits``.
 *
 * Parameters
 * ----------
 * fetchUnits : () => Promise<T[]>
 *     Fetches the full catalog once (e.g. ``() =>
 *     api.codelists.g3dv3().then((r) => r.units)``).
 *
 * Returns
 * -------
 * { useCatalog, resetForTesting }
 *     ``useCatalog`` is the hook; ``resetForTesting`` clears the
 *     factory-scoped cache + in-flight promise so tests can stub different
 *     fetch responses across runs without leaking state.
 */
export function createCatalogHook<T>(fetchUnits: () => Promise<T[]>): {
  useCatalog: () => CatalogState<T>
  resetForTesting: () => void
} {
  let cache: T[] | null = null
  let inflight: Promise<T[]> | null = null

  async function loadCatalog(): Promise<T[]> {
    if (cache !== null) return cache
    if (inflight !== null) return inflight
    inflight = fetchUnits().then((units) => {
      cache = units
      inflight = null
      return units
    })
    return inflight
  }

  function useCatalog(): CatalogState<T> {
    const [state, setState] = useState<CatalogState<T>>({
      units: cache,
      loading: cache === null,
      error: null,
    })

    useEffect(() => {
      if (cache !== null) {
        setState({ units: cache, loading: false, error: null })
        return
      }
      let cancelled = false
      loadCatalog()
        .then((units) => {
          if (!cancelled) setState({ units, loading: false, error: null })
        })
        .catch((err: Error) => {
          if (!cancelled) setState({ units: null, loading: false, error: err })
        })
      return () => {
        cancelled = true
      }
    }, [])

    return state
  }

  return {
    useCatalog,
    resetForTesting: () => {
      cache = null
      inflight = null
    },
  }
}
