/**
 * Process-singleton G3Dv3 catalog loader.
 *
 * The catalog is ~117 entries (~40 KB on the wire), static across the
 * backend's process lifetime, and read by multiple components — the
 * FormationDialog autocomplete today, future surfaces (manual-create
 * Sidebar shortcut, validator messages) tomorrow.
 *
 * Behaviour:
 * - First call kicks a single ``GET /codelists/g3dv3`` request.
 * - Concurrent first calls share the in-flight promise (no duplicate
 *   fetches).
 * - Successful fetches populate a module-level cache so subsequent
 *   mounts resolve synchronously.
 * - Failures surface as ``error`` so the caller can degrade
 *   gracefully (the dialog falls back to a plain text input).
 */

import { useEffect, useState } from 'react'

import { api, type G3Dv3UnitResponse } from '../api/client'

let _cache: G3Dv3UnitResponse[] | null = null
let _inflight: Promise<G3Dv3UnitResponse[]> | null = null

async function loadCatalog(): Promise<G3Dv3UnitResponse[]> {
  if (_cache !== null) return _cache
  if (_inflight !== null) return _inflight
  _inflight = api.codelists.g3dv3().then(resp => {
    _cache = resp.units
    _inflight = null
    return _cache
  })
  return _inflight
}

interface CatalogState {
  units: G3Dv3UnitResponse[] | null
  loading: boolean
  error: Error | null
}

export function useG3Dv3Catalog(): CatalogState {
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

// Test-only escape hatch — resets the module cache so tests can stub
// different fetch responses across runs without leaking state.
export function _resetG3Dv3CatalogCacheForTesting(): void {
  _cache = null
  _inflight = null
}
