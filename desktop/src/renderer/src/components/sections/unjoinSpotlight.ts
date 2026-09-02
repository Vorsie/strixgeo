// The un-join spotlight guard (debt #278 D3) — pure, so the "light only what
// carries the anchor layer" rule is pinnable without the overlay's DOM.
//
// Hovering "Ontkoppelen van X" (BodyContextMenu / GeotechBandEditOverlay) hands
// the overlay body X's ANCHOR layer id. ``PartitionFillOverlay`` then dims every
// fill and lets only the fills carrying that layer stand at natural opacity — but
// only when SOMETHING carries it. An anchor that surfaces nowhere would dim the
// whole canvas and highlight nothing, which reads as a broken response, so the
// guard withholds the highlight in that case and the normal render stands.
//
// The D3 fix: an anchor may surface ONLY as an on-column band (a column strip),
// never in a between-column region. Before D3 the guard consulted regions only,
// so such an anchor gave a null guard and lit nothing. It now consults BOTH the
// between-column region layer-id sets AND the on-column strips.

/**
 * The layer id the spotlight should light, or ``null`` for the normal render.
 *
 * Parameters
 * ----------
 * highlightLayerId
 *     The hovered "Ontkoppelen" item's other-anchor layer id, or null/undefined.
 * regionLayerIdSets
 *     Each between-column region's ``layerIds`` (may be undefined per region).
 * stripLayerIds
 *     The on-column band strips' layer ids (D3 — one per ``ColumnStripQuad``).
 *
 * Returns
 * -------
 * string | null
 *     ``highlightLayerId`` when a region OR a strip carries it; ``null`` when no
 *     highlight is set, or when nothing on screen carries it.
 */
export function resolveHighlightLayer(
  highlightLayerId: string | null | undefined,
  regionLayerIdSets: ReadonlyArray<readonly string[] | undefined>,
  stripLayerIds: readonly string[],
): string | null {
  const hl = highlightLayerId ?? null
  if (hl === null) return null
  const inRegion = regionLayerIdSets.some(ids => ids?.includes(hl))
  const inStrip = stripLayerIds.includes(hl)
  return inRegion || inStrip ? hl : null
}
