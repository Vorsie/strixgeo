// The fence-cutout panel filter — pure, so the body scope's one visual act
// (which walls survive) is pinnable without Cesium.
//
// Owner ruling 2026-08-27 (his exact complaint was this surface: the cutout
// showed a disconnected body he did not select): "a body is only a body if it
// is geometrically connected or if the users says, this body is the same as
// that body." Fence panels already carry ``bodyId`` — the partition regions
// they are built from stamp it (``FenceRegion.bodyId``) — so the scope acts
// as a filter, never a re-derivation.

import type { FencePanel } from '../../../utils/fencePanels'
import type { ParameterUnitScope } from '../../ShellContext'

/**
 * The wall panels the R4 cutout shows for one scope.
 *
 * Pooled scope (``bodyId`` absent or null): every panel of the formation —
 * today's filter, byte-identical. Body scope: only panels the fill stamped
 * with THAT body; a panel with no body attribution (fallback paint) is not
 * the chosen body and is excluded.
 *
 * Parameters
 * ----------
 * panels
 *     The whole-project fence panels, or ``undefined`` while the fence has
 *     not been assembled yet (passed through so loading stays loading).
 * scope
 *     The typed unit scope.
 *
 * Returns
 * -------
 * FencePanel[] | undefined
 *     The cutout, or ``undefined`` when ``panels`` was.
 */
export function fenceCutoutPanels(
  panels: readonly FencePanel[] | undefined,
  scope: ParameterUnitScope,
): FencePanel[] | undefined {
  if (panels === undefined) return undefined
  const bodyId = scope.bodyId ?? null
  return panels.filter(
    p => p.formationId === scope.unitId && (bodyId === null || p.bodyId === bodyId),
  )
}
