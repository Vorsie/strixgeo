/**
 * Process-singleton G3Dv3 catalog loader.
 *
 * The catalog is ~117 entries (~40 KB on the wire), static across the
 * backend's process lifetime, and read by multiple components — the
 * FormationDialog autocomplete today, future surfaces (manual-create
 * Sidebar shortcut, validator messages) tomorrow.
 *
 * Implementation lives in {@link createCatalogHook} (shared with the
 * formal-stratigraphy catalog): first call fetches once, concurrent first
 * calls share the in-flight promise, successes cache for the process
 * lifetime, failures surface as ``error`` so the caller can degrade
 * gracefully (the dialog falls back to a plain text input).
 */

import { api, type G3Dv3UnitResponse } from '../api/client'
import { createCatalogHook, type CatalogState } from './createCatalogHook'

const g3dv3Catalog = createCatalogHook<G3Dv3UnitResponse>(() =>
  api.codelists.g3dv3().then(resp => resp.units),
)

/** Hook returning the shared G3Dv3 catalog state. */
export function useG3Dv3Catalog(): CatalogState<G3Dv3UnitResponse> {
  return g3dv3Catalog.useCatalog()
}

// Test-only escape hatch — resets the module cache so tests can stub
// different fetch responses across runs without leaking state.
export function _resetG3Dv3CatalogCacheForTesting(): void {
  g3dv3Catalog.resetForTesting()
}
