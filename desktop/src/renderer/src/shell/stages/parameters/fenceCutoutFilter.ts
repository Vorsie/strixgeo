// The fence-cutout panel filter — pure, so the body scope's one visual act
// (which walls survive) is pinnable without Cesium.
//
// Owner ruling 2026-08-27 (his exact complaint was this surface: the cutout
// showed a disconnected body he did not select): "a body is only a body if it
// is geometrically connected or if the users says, this body is the same as
// that body."
//
// AMENDED 2026-08-27 after a live-data disproof (CS1): the MD sand's wall is
// continuous and single-formation, yet the body-scoped cutout showed GAPS
// inside it. The old clause ``p.bodyId === scope.bodyId`` compared the fill
// region's ``bodyId`` LABEL — which the merge/weld mints locally and the
// geotech hierarchical fill can stamp with LITHO frame ids — so mid-run
// segments of one body dropped out. A panel belongs to the scoped body iff
// its SOURCE LAYERS say so: the panel's ``layerIds`` resolved through
// ``litho_layer.body_id``, the same label-independent authority
// ``regionBodyId.ts`` documents. The label is never consulted.
//
// Membership is ANY-layer (unlike the jump's exactly-one rule in
// ``regionBodyId``): a wall segment welded across a boundary carries layers
// of both sides and belongs to BOTH bodies — dropping it would recreate the
// gap. The jump needs one unambiguous identity; the filter needs to keep
// every wall the body's ground painted.

import type { FencePanel } from '../../../utils/fencePanels'
import type { ParameterUnitScope } from '../../ShellContext'

/**
 * The wall panels the R4 cutout shows for one scope.
 *
 * Pooled scope (``bodyId`` absent or null): every panel of the formation —
 * today's filter, byte-identical. Body scope: only panels at least one of
 * whose source layers the resolver stamped with THAT body; the formation
 * clause does not apply (a body can span twin formation rows), and a panel
 * with no source layers (fallback paint) or none resolving to the body is
 * excluded.
 *
 * Parameters
 * ----------
 * panels
 *     The whole-project fence panels, or ``undefined`` while the fence has
 *     not been assembled yet (passed through so loading stays loading).
 * scope
 *     The typed unit scope.
 * bodyIdByLayerId
 *     ``litho_layer id → body_id`` over the AXIS'S OWN layer list — the
 *     resolver's stamps, the body authority. Only read under a body scope.
 *
 * Returns
 * -------
 * FencePanel[] | undefined
 *     The cutout, or ``undefined`` when ``panels`` was.
 */
export function fenceCutoutPanels(
  panels: readonly FencePanel[] | undefined,
  scope: ParameterUnitScope,
  bodyIdByLayerId: ReadonlyMap<string, string | null>,
): FencePanel[] | undefined {
  if (panels === undefined) return undefined
  const bodyId = scope.bodyId ?? null
  if (bodyId === null) {
    return panels.filter(p => p.formationId === scope.unitId)
  }
  return panels.filter(p =>
    (p.layerIds ?? []).some(layerId => (bodyIdByLayerId.get(layerId) ?? null) === bodyId),
  )
}
