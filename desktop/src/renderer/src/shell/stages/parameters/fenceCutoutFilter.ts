// The fence-cutout panel filter — pure, so the scope's one visual act (which
// walls survive) is pinnable without Cesium.
//
// Owner ruling 2026-08-27 (his exact complaint was this surface: the cutout
// showed a disconnected body he did not select): "a body is only a body if it
// is geometrically connected or if the user says, this body is the same as
// that body."
//
// A panel belongs to a body iff its SOURCE LAYERS say so: the panel's
// ``layerIds`` resolved through ``litho_layer.body_id``, the same
// label-independent authority ``regionBodyId.ts`` documents. The panel's own
// ``bodyId`` LABEL (weld-minted / frame-stamped) is NEVER consulted — it
// dropped mid-run segments of one continuous body on CS1 (amended 2026-08-27).
//
// GENERALISED to a body SET (spec §4, 2026-08-27): a class row's cutout keeps
// every panel belonging to ANY of the row's geotech bodies. Membership is
// ANY-layer (unlike the jump's exactly-one rule): a wall welded across a
// boundary carries layers of both sides and belongs to BOTH — dropping it
// recreates the gap.

import type { FencePanel } from '../../../utils/fencePanels'
import type { ParameterUnitScope } from '../../ShellContext'

/**
 * Which walls a scope's cutout shows: an aggregate UNIT keeps its formation's
 * panels; anything narrower keeps a SET of resolver bodies' panels.
 */
export type CutoutFilter = { formationId: string } | { bodyIds: ReadonlySet<string> }

/**
 * The cutout filter a scope wants, derived from the scope's own bands.
 *
 * A pooled unit (litho-unit / geotech-unit) filters by its formation id — every
 * panel of the formation, including unstamped paint. A body / body-set scope
 * (litho-body / geotech-body / geotech-class) filters by the union of the
 * scope's bands' resolver bodies: one body for a leaf, the class's bodies for a
 * class row.
 *
 * Parameters
 * ----------
 * scope
 *     The typed unit scope.
 * scopeBands
 *     The scope's bands from ``bandsForScope`` (the single authority). Read for
 *     the body set only; ignored for a unit scope.
 *
 * Returns
 * -------
 * CutoutFilter
 *     A formation filter or a body-set filter.
 */
export function cutoutFilterForScope(
  scope: ParameterUnitScope,
  scopeBands: readonly { body_id?: string | null }[],
): CutoutFilter {
  if (scope.kind === 'litho-unit' || scope.kind === 'geotech-unit') {
    return { formationId: scope.unitId }
  }
  const bodyIds = new Set<string>()
  for (const b of scopeBands) if ((b.body_id ?? null) !== null) bodyIds.add(b.body_id as string)
  return { bodyIds }
}

/**
 * The wall panels the R4 cutout shows for one filter.
 *
 * Parameters
 * ----------
 * panels
 *     The whole-project fence panels, or ``undefined`` while the fence has not
 *     been assembled yet (passed through so loading stays loading).
 * filter
 *     A formation filter (pooled unit) or a body-set filter — from
 *     ``cutoutFilterForScope``.
 * bodyIdByLayerId
 *     ``litho_layer id → body_id`` over the axis's own layer list — the
 *     resolver's stamps, the body authority. Only read for a body-set filter.
 *
 * Returns
 * -------
 * FencePanel[] | undefined
 *     The cutout, or ``undefined`` when ``panels`` was.
 */
export function fenceCutoutPanels(
  panels: readonly FencePanel[] | undefined,
  filter: CutoutFilter,
  bodyIdByLayerId: ReadonlyMap<string, string | null>,
): FencePanel[] | undefined {
  if (panels === undefined) return undefined
  if ('formationId' in filter) {
    return panels.filter(p => p.formationId === filter.formationId)
  }
  const { bodyIds } = filter
  return panels.filter(p =>
    (p.layerIds ?? []).some(layerId => {
      const bodyId = bodyIdByLayerId.get(layerId) ?? null
      return bodyId !== null && bodyIds.has(bodyId)
    }),
  )
}
