/**
 * Packing-tie lookup for the geotech fraction-space refinement.
 *
 * OWNER RULING 2026-08-04 (evening dogfeed): the geotech gap fill consumes
 * packing correlation edges with the LITHO stage's 2/1/0 semantics, so the
 * engineer can hand-correlate packing between CPTs and see the fill obey. This
 * module holds the edge bookkeeping only — the geometry stays in
 * ``refineLithoPartition.ts`` (whose every guard was forced by a real defect).
 *
 * The counting rule is litho's 2/1/0 transposed onto NAD packing spans, with
 * one deliberate difference from ``classifyTermination`` (review F4):
 * ``classifyTermination`` asks "is this layer correlated to ANY layer on the
 * facing column", while pairing needs the PAIR-SPECIFIC reading — "are THESE
 * two spans' contacts correlated to each other". Same edge sets, stricter
 * question; this is a named residual divergence between the two arms until
 * one rule governs both (inherit DRAFT OQ-1):
 *
 *   - **top contact** correlated ⟺ a top-keyed edge joins the two spans' own
 *     (topmost) layer ids;
 *   - **base contact** correlated ⟺ a top-keyed edge joins the layers
 *     immediately BELOW each span in its own column (a layer id keys the
 *     contact at its TOP, so the layer below owns this span's base), OR a
 *     bottom-tie edge (``aSide`` = ``bSide`` = ``'base'``) joins the two spans'
 *     own deepest layer ids — the only path for a column's deepest layer.
 *
 * ``2 → BAND`` is the only outcome this module is asked about; the caller maps
 * 1 and 0 onto its unmatched-span machinery. Mixed (top↔base) edges contribute
 * to NEITHER contact, exactly as ``computeSectionFill`` keeps its three edge
 * sets separate, so a base tie can never make a top contact look correlated.
 */

import type { CorrelationEdge } from './partitionFill'

/** The layer ids a packing span needs in order to be tie-checked. */
export interface PackingSpanTieKeys {
  /** Layer id of the span's SHALLOWEST layer — keys its top contact. */
  topLayerId: string
  /** Layer id of the span's DEEPEST layer — keys a bottom-tie on its base. */
  baseLayerId: string
  /**
   * Layer id immediately below the span in its own column, or ``null`` at the
   * bottom of the column. Its top contact IS this span's base contact.
   */
  belowLayerId: string | null
}

/** Order-independent key for a layer-id pair. */
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * Index a section's approved packing edges for contact counting.
 *
 * @param edges Approved geotech correlation edges, keyed by geotech
 *   ``litho_layer`` id — the same rows the build arm is fed.
 * @returns A function counting how many of two spans' bounding contacts are
 *   correlated to each other (0, 1 or 2).
 */
export function makePackingTieCounter(
  edges: readonly CorrelationEdge[],
): (a: PackingSpanTieKeys, b: PackingSpanTieKeys) => number {
  const topTies = new Set<string>()
  const baseTies = new Set<string>()
  for (const e of edges) {
    const aTop = e.aSide === 'top' || e.aSide == null
    const bTop = e.bSide === 'top' || e.bSide == null
    if (aTop && bTop) topTies.add(pairKey(e.a, e.b))
    else if (e.aSide === 'base' && e.bSide === 'base') baseTies.add(pairKey(e.a, e.b))
    // Mixed top↔base ties are the litho engine's "this unit continues to the
    // tied contact" declaration, whose geometry has no counterpart in fraction
    // space; they are ignored here rather than counted as either contact.
  }
  return (a, b) => {
    let n = 0
    if (topTies.has(pairKey(a.topLayerId, b.topLayerId))) n++
    const baseTied =
      (a.belowLayerId !== null &&
        b.belowLayerId !== null &&
        topTies.has(pairKey(a.belowLayerId, b.belowLayerId))) ||
      baseTies.has(pairKey(a.baseLayerId, b.baseLayerId))
    if (baseTied) n++
    return n
  }
}
