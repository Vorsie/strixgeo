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
  /** No single body could be resolved (fallback paint, several bodies, or none); stay armed. */
  | { kind: 'unresolvable' }
  /**
   * The clicked region resolves to the SAME single layer as the armed anchor — a
   * one-region body armed then clicked on its own patch. Both separation anchors
   * would be that one layer (anchor == target), which the backend 422s, so this
   * is a no-op: advise the engineer to click a different part and stay armed.
   */
  | { kind: 'self-anchor' }
  /**
   * A body resolved — commit the separation between these two anchors. ``sameBody``
   * distinguishes the two commit cases so the toast can be honest:
   *
   * * ``true`` — the picked region is the SAME body as the arm: two anchors inside
   *   one component, which the backend cuts into two bodies (the split case, the
   *   PRIMARY use after the identity merges leave visually-distinct masses sharing
   *   one row — owner dogfeed 2026-09-01);
   * * ``false`` — a DIFFERENT body: a durable cannot-link so the two never re-union.
   */
  | { kind: 'commit'; anchorLayerId: string; targetAnchorLayerId: string; sameBody: boolean }

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
 * Rules (owner dogfeed 2026-09-01): a resolved body — SAME or DIFFERENT —
 * COMMITS; only a region that resolves to no single body stays armed. A
 * SAME-body pick is the SPLIT case (two anchors inside one component, cut by the
 * backend); a DIFFERENT-body pick is a durable keep-apart. The ``sameBody`` flag
 * on the commit carries which, for the toast copy — the backend accepts both
 * (same-body anchors are the split it performs). The one commit it must NOT make
 * is anchor == target (a one-region body clicked on its own patch) — that 422s,
 * so it returns ``self-anchor`` and stays armed.
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
 *     ``commit`` (with ``sameBody``) when a distinct anchor resolves;
 *     ``self-anchor`` when the region resolves to the armed anchor itself;
 *     ``unresolvable`` when no single body resolves (both keep the arm live).
 */
export function resolveSeparatePick(
  arm: { bodyId: string; anchorLayerId: string },
  regionLayerIds: readonly string[] | undefined,
  bodyIdByLayerId: ReadonlyMap<string, string | null>,
): SeparatePick {
  const targetBodyId = resolveRegionBodyId(regionLayerIds, bodyIdByLayerId)
  if (targetBodyId === null) return { kind: 'unresolvable' }
  const targetAnchorLayerId = firstLayerStampedToBody(regionLayerIds, targetBodyId, bodyIdByLayerId)
  // resolveRegionBodyId already proved one layer carries this body, so the
  // anchor lookup cannot miss — the guard keeps the type honest, not the logic.
  if (targetAnchorLayerId === null) return { kind: 'unresolvable' }
  // Same single layer at both ends (a one-region body armed then clicked on its
  // own patch): the backend 422s on anchor == target. A no-op — advise, stay armed.
  if (targetAnchorLayerId === arm.anchorLayerId) return { kind: 'self-anchor' }
  return {
    kind: 'commit',
    anchorLayerId: arm.anchorLayerId,
    targetAnchorLayerId,
    sameBody: targetBodyId === arm.bodyId,
  }
}
