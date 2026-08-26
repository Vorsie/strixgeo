/**
 * Drop a set of investigations from one model's build inputs, as if they had
 * never been imported.
 *
 * Owner ruling 2026-08-26: *"Build without them should produce the model that
 * was there before the added tests, so just plain ignore them."* The word
 * "plain" is the specification — the excluded test must leave NOTHING behind:
 * not a projected column, not a layer row, and not a correlation edge anchored
 * on one of its layers. A dangling edge is the residue that matters most: the
 * partition engine reads an edge as a statement that two units are the same
 * body, and an edge whose far end no longer has a column is exactly the shape
 * that produced the phantom bands killed on CS3 (2026-08-25).
 *
 * Applied per MODEL, so the geotech build calls it twice: once for the packing
 * bands and once for the litho frame those bands are drawn on. Excluding the
 * test from only one of the two would leave the frame splitting a gap the
 * packing fill has no data for — the hole the ruling exists to close.
 *
 * @module utils/excludeInvestigationsFromBuild
 */

import type {
  ApprovedEdge,
  InvestigationLocation,
  LithoLayerLike,
} from './assembleLithoSectionInputs'

/** One model's build inputs, before or after the exclusion. */
export interface BuildInputSlice {
  /** The investigations that may be projected as columns. */
  investigations: readonly InvestigationLocation[]
  /** The model's layer rows. */
  layers: readonly LithoLayerLike[]
  /** Approved correlation edges per section id. */
  edgesBySectionId: ReadonlyMap<string, readonly ApprovedEdge[]>
}

/**
 * Remove every trace of the named investigations from one model's build inputs.
 *
 * Parameters
 * ----------
 * slice : BuildInputSlice
 *     The investigations, layers and per-section edges as assembled today.
 * excludedInvestigationIds : ReadonlySet<string>
 *     CPT / borehole ids to ignore. EMPTY returns ``slice`` unchanged, by
 *     reference — the default build path must not pay for, or risk, a rewrite
 *     it did not ask for.
 *
 * Returns
 * -------
 * BuildInputSlice
 *     The same shape with the excluded investigations, their layers, and every
 *     edge touching one of those layers removed.
 */
export function excludeInvestigationsFromBuild(
  slice: BuildInputSlice,
  excludedInvestigationIds: ReadonlySet<string>,
): BuildInputSlice {
  if (excludedInvestigationIds.size === 0) return slice

  const droppedLayerIds = new Set<string>()
  const layers: LithoLayerLike[] = []
  for (const layer of slice.layers) {
    // Anchor XOR: a layer stands on exactly one of the two, and a layer with
    // neither has no column to be excluded from.
    const anchorId = layer.cpt_id ?? layer.borehole_id
    if (anchorId !== null && anchorId !== undefined && excludedInvestigationIds.has(anchorId)) {
      droppedLayerIds.add(layer.id)
      continue
    }
    layers.push(layer)
  }

  const edgesBySectionId = new Map<string, readonly ApprovedEdge[]>()
  for (const [sectionId, edges] of slice.edgesBySectionId) {
    edgesBySectionId.set(
      sectionId,
      edges.filter(e => !droppedLayerIds.has(e.a) && !droppedLayerIds.has(e.b)),
    )
  }

  return {
    investigations: slice.investigations.filter(i => !excludedInvestigationIds.has(i.id)),
    layers,
    edgesBySectionId,
  }
}
