/**
 * Process-singleton DOV formal-stratigraphy catalog loader.
 *
 * The catalog is ~403 entries, static across the backend's process lifetime,
 * and read by the FormationDialog's "Formal stratigraphy" autocomplete (the
 * informal→formal link). Implementation lives in {@link createCatalogHook}
 * (shared with {@link useG3Dv3Catalog}): first call fetches once, concurrent
 * first calls share the in-flight promise, successes cache for the process
 * lifetime, failures surface as ``error`` so the dialog degrades to a plain
 * code input.
 */

import { api, type FormalStratigraphyUnitResponse } from '../api/client'
import { createCatalogHook, type CatalogState } from './createCatalogHook'

const formalStratigraphyCatalog = createCatalogHook<FormalStratigraphyUnitResponse>(() =>
  api.codelists.formalStratigraphy().then(resp => resp.units),
)

/** Hook returning the shared formal-stratigraphy catalog state. */
export function useFormalStratigraphyCatalog(): CatalogState<FormalStratigraphyUnitResponse> {
  return formalStratigraphyCatalog.useCatalog()
}

/** Test-only escape hatch — resets the module cache between runs. */
export function _resetFormalStratigraphyCatalogCacheForTesting(): void {
  formalStratigraphyCatalog.resetForTesting()
}
