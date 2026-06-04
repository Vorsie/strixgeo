/**
 * Pure helpers for resolving a body cap's ANCHOR layer.
 *
 * A body extent cap (open / pinch / extrapolated) renders from a single
 * litho_layer — the spatial source of truth for its column + depth interval.
 * When the user open-ends a specific layer, that layer IS the anchor. When the
 * gesture is a body-level "claim left/right" (no specific layer clicked), the
 * anchor is the body's EXTREME on-section member for that side — the band end
 * the cap visually hangs off.
 *
 * Kept here (not inline in a component) so the claim path (SectionPanel) and
 * the render path (BodyExtentOverlay fallback) share one definition of
 * "leftmost / rightmost member", per the no-duplicate-logic rule.
 */

import type { LithoLayerResponse } from '../api/client'
import type { PlacedColumn } from '../components/sections/utils'

/** A layer's anchor investigation id (cpt XOR borehole). */
function layerAnchorInvId(layer: LithoLayerResponse): string | null {
  return layer.cpt_id ?? layer.borehole_id ?? null
}

/**
 * Resolve the body's EXTREME on-section member layer for one side.
 *
 * Members are the accepted litho layers the resolver stamped with this
 * ``body_id``. Each is projected to its column's along-position; the leftmost
 * (smallest along) wins for the left side, the rightmost (largest along) for
 * the right. Members whose column is not on this section are ignored.
 *
 * @param bodyId - The body whose cap is being anchored.
 * @param side - ``'left'`` or ``'right'``.
 * @param lithoLayers - All accepted litho layers (member lookup by ``body_id``).
 * @param columns - The placed columns on this section (along + investigation id).
 * @returns The extreme member layer's id, or ``null`` when the body has no
 *   on-section member (the caller leaves the cap unanchored → legacy fallback).
 */
export function extremeMemberLayerId(
  bodyId: string,
  side: 'left' | 'right',
  lithoLayers: readonly LithoLayerResponse[],
  columns: readonly PlacedColumn[],
): string | null {
  const alongByInv = new Map<string, number>()
  for (const col of columns) alongByInv.set(col.proj.item.id, col.proj.along)

  let bestId: string | null = null
  let bestAlong = side === 'left' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  for (const layer of lithoLayers) {
    if (layer.body_id !== bodyId) continue
    const inv = layerAnchorInvId(layer)
    if (inv === null) continue
    const along = alongByInv.get(inv)
    if (along === undefined) continue // not on this section
    if (side === 'left' ? along < bestAlong : along > bestAlong) {
      bestAlong = along
      bestId = layer.id
    }
  }
  return bestId
}
