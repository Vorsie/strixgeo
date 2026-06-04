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

/**
 * The investigation the body pinches out TOWARD on one side — the nearest
 * on-section column just BEYOND the body's extreme member.
 *
 * A ``pinch_out_halfway`` / ``extrapolated`` extent needs this neighbour: the
 * cap is drawn between the body's edge member and the neighbouring column where
 * the body is absent. (An ``open`` extent needs no neighbour — it just runs a
 * fixed length past the edge.) Returns ``null`` when the extreme member sits at
 * the section edge (no column beyond it), in which case a pinch-out is
 * meaningless and the caller should fall back to ``open`` / refuse.
 *
 * @param bodyId - The body whose pinch target is sought.
 * @param side - ``'left'`` or ``'right'``.
 * @param lithoLayers - All accepted litho layers (member lookup by ``body_id``).
 * @param columns - The placed columns on this section (along + investigation id).
 * @returns The neighbouring investigation id, or ``null`` when none exists.
 */
export function neighbourInvBeyondExtreme(
  bodyId: string,
  side: 'left' | 'right',
  lithoLayers: readonly LithoLayerResponse[],
  columns: readonly PlacedColumn[],
): string | null {
  const alongByInv = new Map<string, number>()
  for (const col of columns) alongByInv.set(col.proj.item.id, col.proj.along)

  // The body's extreme member along-position on this side.
  let extremeAlong: number | null = null
  for (const layer of lithoLayers) {
    if (layer.body_id !== bodyId) continue
    const inv = layerAnchorInvId(layer)
    if (inv === null) continue
    const along = alongByInv.get(inv)
    if (along === undefined) continue
    if (
      extremeAlong === null ||
      (side === 'left' ? along < extremeAlong : along > extremeAlong)
    ) {
      extremeAlong = along
    }
  }
  if (extremeAlong === null) return null

  // The nearest column just beyond the extreme member on this side.
  let bestInv: string | null = null
  let bestAlong = side === 'left' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  for (const col of columns) {
    const along = col.proj.along
    if (side === 'left') {
      if (along < extremeAlong && along > bestAlong) {
        bestAlong = along
        bestInv = col.proj.item.id
      }
    } else {
      if (along > extremeAlong && along < bestAlong) {
        bestAlong = along
        bestInv = col.proj.item.id
      }
    }
  }
  return bestInv
}
