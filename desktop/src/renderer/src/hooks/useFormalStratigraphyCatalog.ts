/**
 * Process-singleton DOV formal-stratigraphy catalog loader.
 *
 * The catalog is ~403 entries, static across the backend's process lifetime,
 * and read by the FormationDialog's "Formal stratigraphy" autocomplete (the
 * informal→formal link). Mirrors {@link useG3Dv3Catalog}:
 * - First call kicks a single ``GET /codelists/formal-stratigraphy`` request.
 * - Concurrent first calls share the in-flight promise.
 * - Successful fetches populate a module-level cache.
 * - Failures surface as ``error`` so the dialog degrades to a plain code input.
 */

import { useEffect, useState } from 'react'

import { api, type FormalStratigraphyUnitResponse } from '../api/client'

let _cache: FormalStratigraphyUnitResponse[] | null = null
let _inflight: Promise<FormalStratigraphyUnitResponse[]> | null = null

async function loadCatalog(): Promise<FormalStratigraphyUnitResponse[]> {
  if (_cache !== null) return _cache
  if (_inflight !== null) return _inflight
  _inflight = api.codelists.formalStratigraphy().then(resp => {
    _cache = resp.units
    _inflight = null
    return _cache
  })
  return _inflight
}

interface CatalogState {
  units: FormalStratigraphyUnitResponse[] | null
  loading: boolean
  error: Error | null
}

export function useFormalStratigraphyCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>({
    units: _cache,
    loading: _cache === null,
    error: null,
  })

  useEffect(() => {
    if (_cache !== null) {
      setState({ units: _cache, loading: false, error: null })
      return
    }
    let cancelled = false
    loadCatalog()
      .then(units => {
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

/** Test-only escape hatch — resets the module cache between runs. */
export function _resetFormalStratigraphyCatalogCacheForTesting(): void {
  _cache = null
  _inflight = null
}
