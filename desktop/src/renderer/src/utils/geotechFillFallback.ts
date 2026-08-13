/**
 * Litho-colour fallback for the geotech axis's DIRECT partition render.
 *
 * Owner ruling 2026-08-13: the geotech axis stops rendering the litho partition
 * refined by NAD class and renders the GEOTECH partition directly — the same
 * computation the 3-D build arm runs ("we don't need to invent the fill bands
 * engine, it is built for the litho stage — we only have more classes"). Litho
 * geometry stays visually authoritative: its region envelopes draw as dark
 * outlines on top, and any litho region the geotech model has NO bands for is
 * painted in its LITHOLOGY colour beneath the geotech fills.
 *
 * This module decides the second half of that: WHICH litho regions the geotech
 * partition leaves unpainted. Pure — the caller owns projection and paint.
 */

/** One packing band on an investigation column, in absolute elevation. */
export interface FallbackPackingBand {
  /** Top of the band in metres (mTAW). */
  topElevM: number
  /** Base of the band in metres (mTAW); always below ``topElevM``. */
  baseElevM: number
  /**
   * The band's main soil code (from its geotech formation), or null when the
   * formation carries none.
   */
  soilCode: string | null
}

/** The litho-region fields the rule reads (callers may carry more). */
export interface FallbackCandidateRegion {
  /** Index of the gap the region tiles; flanked by columns ``i`` and ``i + 1``. */
  gapIndex: number
  /** The region's LITHO formation id — its lithology, hence its soil code. */
  formationId: string
  /** Region ring; only the elevations are read (the vertical envelope). */
  polygon: readonly { elevation: number }[]
}

/**
 * Vertical tolerance, metres.
 *
 * Mirrors ``makeClassSlicesElev`` in ``refineLithoPartition.ts``, whose
 * any-overlap filter is ``u.tE > base + 0.02 && u.bE < top - 0.02``: a band
 * grazing a region by less than 2 cm is NOT that region's packing. Keeping the
 * same number means the fallback and the retired refinement agree on where
 * packing data exists, so switching engines cannot silently repaint a region
 * that was already classified.
 */
const OVERLAP_SLOP_M = 0.02

/**
 * Select the litho regions the geotech partition does not cover.
 *
 * A region is FALLBACK when NEITHER flanking column carries a packing band of
 * the region's own soil overlapping the region's elevation envelope. One packed
 * side is enough to disqualify it: the geotech partition reaches across a gap
 * from a single tied column, so a region with data on one side is already
 * painted in NAD colours and must not be double-painted in lithology colour.
 *
 * The soil guard is the refinement engine's own: a sand band can never stand in
 * for a clay region ("silt transitioning into a sand lens"). A region whose
 * lithology carries no soil code accepts any packing soil, matching the
 * engine's ``soil == null`` branch.
 *
 * Parameters
 * ----------
 * regions : readonly R[]
 *     The litho partition's regions (lens regions included or excluded by the
 *     caller — this rule does not filter by kind).
 * columnOrder : readonly string[]
 *     Investigation ids left→right, 1:1 with the litho partition's columns.
 * packingBandsByInvestigation : ReadonlyMap<string, readonly FallbackPackingBand[]>
 *     Geotech bands per investigation id, in absolute elevation. A missing or
 *     empty entry means "this column has no packing".
 * lithoSoilByFormationId : ReadonlyMap<string, string | null>
 *     Litho formation id → main soil code.
 *
 * Returns
 * -------
 * R[]
 *     The subset of ``regions`` (the caller's own objects, order preserved)
 *     that must be painted in lithology colour.
 */
export function selectLithoFallbackRegions<R extends FallbackCandidateRegion>(
  regions: readonly R[],
  columnOrder: readonly string[],
  packingBandsByInvestigation: ReadonlyMap<string, readonly FallbackPackingBand[]>,
  lithoSoilByFormationId: ReadonlyMap<string, string | null>,
): R[] {
  const out: R[] = []
  for (const region of regions) {
    let top = -Infinity
    let base = Infinity
    for (const p of region.polygon) {
      if (p.elevation > top) top = p.elevation
      if (p.elevation < base) base = p.elevation
    }
    // A ring with no vertices has no envelope to test; treat it as unpacked
    // rather than crashing on the Infinity sentinels.
    if (!Number.isFinite(top) || !Number.isFinite(base)) {
      out.push(region)
      continue
    }
    const soil = lithoSoilByFormationId.get(region.formationId) ?? null
    const covered = (columnIndex: number): boolean => {
      const investigationId = columnOrder[columnIndex]
      if (investigationId === undefined) return false
      const bands = packingBandsByInvestigation.get(investigationId)
      if (!bands) return false
      return bands.some(
        (b) =>
          (soil === null || b.soilCode === soil) &&
          b.topElevM > base + OVERLAP_SLOP_M &&
          b.baseElevM < top - OVERLAP_SLOP_M,
      )
    }
    if (!covered(region.gapIndex) && !covered(region.gapIndex + 1)) out.push(region)
  }
  return out
}
