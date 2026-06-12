/**
 * buildSectionModelFill — pure helper that maps backend LithoBodySolidResponse
 * objects to the SolidMesh format consumed by sectionFromSolids utilities.
 *
 * Kept pure (no React, no I/O) so it can be fully unit-tested and reused in
 * any context that needs to bridge the API response type to the sampler.
 *
 * Why a separate module (debt #201):
 *   SectionPanel is already a very large file. Placing the mapping logic here
 *   keeps the god-component lean and the business rule ("skip flagged solids,
 *   resolve colour") testable in isolation.
 */

import type { LithoBodySolidResponse } from '../api/clients/geology'
import type { SolidMesh } from './sectionFromSolids'

/**
 * Map an array of backend body-solid responses to ``SolidMesh`` objects ready
 * for ``sampleSolidColumns`` or ``sliceSolidsAtPlane``.
 *
 * Rules
 * -----
 * - Solids with ``is_flagged === true`` are excluded.  Flagged solids are
 *   under-constrained best-effort slabs that may not be watertight; the
 *   ray-sampler and plane-slicer both assume a watertight manifold.
 * - ``display_color`` is used verbatim when present (non-null / non-undefined).
 *   When absent or null, ``colorOf(formationId)`` provides the fallback.
 *
 * @param solids  - Body solid responses from the backend (may include flagged
 *                  solids — they are filtered out here).
 * @param colorOf - Fallback colour resolver: given a ``formation_id``, returns
 *                  a CSS hex colour string.  Called only when ``display_color``
 *                  is null or undefined.
 * @returns ``SolidMesh[]`` with flagged solids removed, colours resolved.
 */
export function buildModelFillMeshes(
  solids: LithoBodySolidResponse[],
  colorOf: (formationId: string) => string,
): SolidMesh[] {
  const result: SolidMesh[] = []

  for (const solid of solids) {
    // Skip under-constrained slabs — they may not be watertight and would
    // produce spurious or inverted ray crossings in the sampler.
    if (solid.is_flagged === true) continue

    // Resolve colour: use the per-body override when present, else delegate
    // to the formation colour lookup so the section fill matches the litho
    // inspector palette.
    const color =
      solid.display_color != null ? solid.display_color : colorOf(solid.formation_id)

    result.push({
      bodyId: solid.body_id,
      formationId: solid.formation_id,
      color,
      vertices: solid.vertices,
      triangles: solid.triangles,
    })
  }

  return result
}
