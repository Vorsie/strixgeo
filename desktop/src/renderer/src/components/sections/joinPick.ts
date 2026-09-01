// Resolve a "Join with…" target click into a commit / advisory / no-op — pure,
// shared by PartitionFillOverlay's armed left-click (debt #278, geotech axis).
//
// The "Join with…" verb (owner ruling 2026-08-31) arms on body A, then the
// engineer clicks the OTHER body to state "these two ARE the same body". Like
// Separate, the pick resolves through the region's ``layerIds`` — the label-
// independent identity currency the recompute already uses (regionBodyId.ts) —
// never a region label. The one extra rule over Separate: a body can only be one
// mass, so a DIFFERENT packing class is refused with a cross-class advisory
// rather than committed (the backend would 422 it anyway).

import { resolveRegionBodyId } from './regionBodyId'

/**
 * The first of ``layerIds`` whose ``body_id`` stamp equals ``bodyId``, or ``null``.
 *
 * The deterministic anchor rule: an anchor is any ACCEPTED layer of the body,
 * and picking the first one keeps the choice stable so the same body always joins
 * through the same anchor. (Formerly in ``separatePick.ts``, moved here when the
 * Separate verb was retired — the body-verb simplification, 2026-09-01.)
 *
 * Parameters
 * ----------
 * layerIds
 *     The candidate layer ids, in order.
 * bodyId
 *     The body the anchor must be stamped to.
 * bodyIdByLayerId
 *     ``litho_layer id → body_id`` over the axis's own layer list.
 *
 * Returns
 * -------
 * str | null
 *     The first stamped layer id, or ``null`` when none of them belong to ``bodyId``.
 */
export function firstLayerStampedToBody(
  layerIds: readonly string[] | undefined,
  bodyId: string,
  bodyIdByLayerId: ReadonlyMap<string, string | null>,
): string | null {
  for (const layerId of layerIds ?? []) {
    if ((bodyIdByLayerId.get(layerId) ?? null) === bodyId) return layerId
  }
  return null
}

/** One clicked-region outcome while a Join is armed. */
export type JoinPick =
  /** The region belongs to the SAME body — a self-join, refused; stay armed. */
  | { kind: 'same' }
  /** No single body could be resolved (fallback paint, several bodies, or none); stay armed. */
  | { kind: 'unresolvable' }
  /**
   * A distinct body resolved but it is a DIFFERENT packing class — never one mass,
   * so the join is refused. Carries both class labels for the advisory toast.
   */
  | { kind: 'cross-class'; classA: string; classB: string }
  /** A distinct SAME-class body resolved — commit the join between these two anchors. */
  | { kind: 'commit'; anchorLayerId: string; targetAnchorLayerId: string }

/** The non-committing outcomes — what the arm advises on without disarming. */
export type JoinNotice = Exclude<JoinPick, { kind: 'commit' }>

/**
 * Classify a clicked region against the armed body for a Join.
 *
 * Rules (ruling's own words: "these two ARE the same body"): a DIFFERENT body of
 * the SAME class commits; the SAME body, or a region resolving to no single
 * body, stays armed; a DIFFERENT-class body is refused with a cross-class
 * advisory. When either side's class is unknown (a map race), the client does
 * NOT block — it commits and lets the write guard be the authority, which can
 * only ever safely widen (label-difference implies class-difference, so a missing
 * class never hides a real cross-class the backend would then accept).
 *
 * Parameters
 * ----------
 * arm
 *     The armed body's id + one of its anchor layer ids.
 * regionLayerIds
 *     The clicked region's ``layerIds`` (absent on fallback paint).
 * bodyIdByLayerId
 *     ``litho_layer id → body_id`` over the axis's own layer list.
 * classByLayerId
 *     ``litho_layer id → packing-class label`` over the axis's own layer list,
 *     for the cross-class guard. A missing entry is silence, not a mismatch.
 *
 * Returns
 * -------
 * JoinPick
 *     ``commit`` with both anchors when a distinct same-class body resolves;
 *     ``cross-class`` / ``same`` / ``unresolvable`` otherwise (all keep the arm live).
 */
export function resolveJoinPick(
  arm: { bodyId: string; anchorLayerId: string },
  regionLayerIds: readonly string[] | undefined,
  bodyIdByLayerId: ReadonlyMap<string, string | null>,
  classByLayerId: ReadonlyMap<string, string>,
): JoinPick {
  const targetBodyId = resolveRegionBodyId(regionLayerIds, bodyIdByLayerId)
  if (targetBodyId === null) return { kind: 'unresolvable' }
  if (targetBodyId === arm.bodyId) return { kind: 'same' }
  const targetAnchorLayerId = firstLayerStampedToBody(regionLayerIds, targetBodyId, bodyIdByLayerId)
  // resolveRegionBodyId already proved one layer carries this body, so the
  // anchor lookup cannot miss — the guard keeps the type honest, not the logic.
  if (targetAnchorLayerId === null) return { kind: 'unresolvable' }
  const classA = classByLayerId.get(arm.anchorLayerId)
  const classB = classByLayerId.get(targetAnchorLayerId)
  if (classA !== undefined && classB !== undefined && classA !== classB) {
    return { kind: 'cross-class', classA, classB }
  }
  return { kind: 'commit', anchorLayerId: arm.anchorLayerId, targetAnchorLayerId }
}
