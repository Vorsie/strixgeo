// Resolve a "Separate from…" target click into a commit / no-op — pure, shared
// by PartitionFillOverlay's armed left-click (debt #278 R5).
//
// The "Separate" verb (owner ruling 2026-08-31) arms on body A, then the
// engineer clicks the OTHER body to state "these two are NOT the same body".
// A region names its body through its ``layerIds`` — the label-independent
// identity currency the recompute already uses (see ``regionBodyId.ts``) — so
// the pick resolves through the layers' ``body_id``, never a region label.

import { resolveRegionBodyId } from './regionBodyId'

/** One clicked-region outcome while a Separate is armed. */
export type SeparatePick =
  /** The region belongs to the SAME body — a self-separation, refused; stay armed. */
  | { kind: 'same' }
  /** No single body could be resolved (fallback paint, several bodies, or none); stay armed. */
  | { kind: 'unresolvable' }
  /** A distinct body resolved — commit the separation between these two anchors. */
  | { kind: 'commit'; anchorLayerId: string; targetAnchorLayerId: string }

/**
 * The first of ``layerIds`` whose ``body_id`` stamp equals ``bodyId``, or ``null``.
 *
 * The deterministic anchor rule both ends of a separation share: an anchor is any
 * ACCEPTED layer of the body, and picking the first one keeps the choice stable.
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

/**
 * Classify a clicked region against the armed body.
 *
 * Rules (ruling's own words: "click the other body → the two are never one body
 * again"): a DIFFERENT resolved body commits; the SAME body, or a region that
 * resolves to no single body, stays armed rather than commit a nonsense
 * separation.
 *
 * Parameters
 * ----------
 * arm
 *     The armed body's id + one of its anchor layer ids.
 * regionLayerIds
 *     The clicked region's ``layerIds`` (absent on fallback paint).
 * bodyIdByLayerId
 *     ``litho_layer id → body_id`` over the axis's own layer list.
 *
 * Returns
 * -------
 * SeparatePick
 *     ``commit`` with both anchors when a distinct body resolves; ``same`` /
 *     ``unresolvable`` otherwise (both keep the arm live).
 */
export function resolveSeparatePick(
  arm: { bodyId: string; anchorLayerId: string },
  regionLayerIds: readonly string[] | undefined,
  bodyIdByLayerId: ReadonlyMap<string, string | null>,
): SeparatePick {
  const targetBodyId = resolveRegionBodyId(regionLayerIds, bodyIdByLayerId)
  if (targetBodyId === null) return { kind: 'unresolvable' }
  if (targetBodyId === arm.bodyId) return { kind: 'same' }
  const targetAnchorLayerId = firstLayerStampedToBody(regionLayerIds, targetBodyId, bodyIdByLayerId)
  // resolveRegionBodyId already proved one layer carries this body, so the
  // anchor lookup cannot miss — the guard keeps the type honest, not the logic.
  if (targetAnchorLayerId === null) return { kind: 'unresolvable' }
  return { kind: 'commit', anchorLayerId: arm.anchorLayerId, targetAnchorLayerId }
}
