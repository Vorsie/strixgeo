/**
 * Geotech section fill = the LITHO partition, subdivided by NAD packing class.
 *
 * Owner directive (2026-06-24, repeated emphatically): "keep the structure from
 * the litho and only subdivide inside a body" / "EXACT same shape, only
 * subdivide inside that polygon". The geotech axis therefore does NOT recompute
 * a partition from geotech layers + geotech edges (that derivation produced far
 * worse connectivity than litho — 79 % singletons on real data — because the
 * NAD-class formationId blocks `pairScore` from banding a loose sand to a dense
 * sand on the neighbour). Instead the geotech fill IS the litho partition
 * (computed once from litho layers + litho edges), and this pure transform
 * subdivides each litho region into NAD sub-bands using the geotech sub-layer
 * depths on the two columns bounding the region's gap.
 *
 * ### All-or-nothing connection (R0 — legacy, pre-R1)
 *
 * The original subdivision mode: sub-bands connect only when the entire sequence
 * matches position-for-position by resolver ``body_id``.  On any mismatch the
 * region keeps its parent shape (dominant NAD recolour). This is the fallback
 * when no ``geotechEdges`` are provided.
 *
 * ### Per-sub-band band/onlap/lens (R1 — owner directive 2026-06-25)
 *
 * When ``geotechEdges`` are passed, each geotech NAD sub-band's shape toward the
 * facing column is decided by how many of its TWO bounding contacts are tied by a
 * geotech packing correlation edge (2 → BAND, 1 → ONLAP, 0 → LENS) — the
 * same contact-correlation model that ``computeSectionFill`` uses for litho, but
 * applied PER LITHO REGION so the litho partition still frames every sub-band.
 * This avoids the 187-singleton trap (running ``computeSectionFill`` directly on
 * geotech sub-bands across the whole section).
 *
 * The geometry stays fully within the enclosing litho region's polygon. A BAND
 * sub-band emits a 4-point quad; an ONLAP emits a triangle pinching toward the
 * tied bracket at ``INTERIOR_PINCH_FRACTION``; a LENS emits a triangle pinching
 * at ``LENS_PINCH_FRACTION``.  The enclosing litho region shape (quad/pinch/lens,
 * gapIndex, bodyId) is always preserved.
 *
 * Pure module — no React, no I/O, no `Date.now` / `Math.random`.
 */

import type {
  CorrelationEdge,
  PartitionColumn,
  PartitionPoint,
  SectionRegion,
} from './partitionFill'
import { INTERIOR_PINCH_FRACTION, LENS_PINCH_FRACTION } from './partitionFill'

const EPS = 1e-6

/** One geotech NAD sub-layer on a column, in depth-below-surface metres. */
export interface GeotechSubLayer {
  topDepthM: number
  baseDepthM: number
  /** The geotech (NAD-class) formation id — drives the band colour + label. */
  formationId: string
  /**
   * The LITHO formation id this geotech sub-layer was derived from
   * (``geological_formation.source_litho_formation_id``). A litho region is
   * subdivided ONLY by the sub-layers whose ``sourceLithoFormationId`` equals the
   * region's (litho) ``formationId`` — so a clay band can only ever be split into
   * clay NAD classes, never a neighbouring sand/silt sub-layer at an adjacent
   * depth. This is the fix for the wrong-soil recolour (a clay region showing a
   * sand NAD colour) seen in the depth-overlap-only v1.
   */
  sourceLithoFormationId: string | null
  /**
   * The resolver's geotech ``body_id`` (``litho_layer.body_id``). Two sub-bands
   * connect across columns into a single cross-column sub-quad ONLY when they
   * share a non-null ``bodyId`` (in addition to the same NAD ``formationId``).
   * ``null`` until the resolver runs → never connects. Spec §6.
   */
  bodyId: string | null
  /**
   * The geotech ``litho_layer.id`` — the stable identity a geotech packing
   * correlation edge references.  When ``geotechEdges`` are passed to
   * ``subdivideRegionsByGeotech`` (R1 mode), each sub-band's shape toward the
   * facing column is decided by how many of its TWO bounding contacts are tied
   * by an approved edge on these ids (2 → band, 1 → onlap, 0 → lens).
   *
   * Optional: absent (undefined) ⟹ treated as uncorrelated (0 tied contacts on
   * that boundary) — safe fallback, reverts to lens behaviour.
   */
  layerId?: string
}

/** A sub-band clamped + snapped to tile one column's slice of a litho band. */
interface ColumnSubBand {
  topDepthM: number
  baseDepthM: number
  formationId: string
  /** Source sub-layer's resolver ``body_id`` — the cross-column connection key. */
  bodyId: string | null
  /** Source sub-layer's ``litho_layer.id`` — the geotech edge endpoint key (R1). */
  layerId: string | undefined
}

/**
 * The geotech sub-layers overlapping a litho band on ONE column, clamped to the
 * band and snapped so they tile it exactly (first top = band top, last base =
 * band base, internal boundaries contiguous). Empty when no sub-layer overlaps.
 *
 * Parameters
 * ----------
 * subLayers : readonly GeotechSubLayer[]
 *     The column's geotech sub-layers (any order).
 * bandTopDepthM, bandBaseDepthM : number
 *     The litho band's depth span on this column (top shallower than base).
 *
 * Returns
 * -------
 * ColumnSubBand[]
 *     Depth-ordered, gap-free sub-bands tiling [bandTopDepthM, bandBaseDepthM],
 *     or `[]` if no sub-layer overlaps the band.
 */
function columnSubBands(
  subLayers: readonly GeotechSubLayer[],
  bandTopDepthM: number,
  bandBaseDepthM: number,
): ColumnSubBand[] {
  const overlapping = subLayers
    .filter(
      (sl) => sl.baseDepthM > bandTopDepthM + EPS && sl.topDepthM < bandBaseDepthM - EPS,
    )
    .map((sl) => ({
      topDepthM: Math.max(sl.topDepthM, bandTopDepthM),
      baseDepthM: Math.min(sl.baseDepthM, bandBaseDepthM),
      formationId: sl.formationId,
      bodyId: sl.bodyId,
      layerId: sl.layerId,
    }))
    .sort((a, b) => a.topDepthM - b.topDepthM)
  if (overlapping.length === 0) return []
  // Snap to tile the band exactly: first sub-band reaches the band top, last
  // reaches the band base, and each internal boundary is the next sub-band's top
  // (kills sub-mm gaps/overlaps from geo-bounding float noise).
  overlapping[0].topDepthM = bandTopDepthM
  overlapping[overlapping.length - 1].baseDepthM = bandBaseDepthM
  for (let i = 0; i < overlapping.length - 1; i += 1) {
    overlapping[i].baseDepthM = overlapping[i + 1].topDepthM
  }
  return overlapping
}

/**
 * The NAD formation covering the largest total elevation-overlap of a band
 * across BOTH bounding columns — the fallback colour when the columns disagree
 * (so the whole band is recoloured without inventing a wedge). Ties resolve to
 * the shallower-first sub-layer (deterministic). Returns `null` when neither
 * column has any overlapping sub-layer.
 */
function dominantNad(
  leftSubs: readonly GeotechSubLayer[],
  rightSubs: readonly GeotechSubLayer[],
  leftBand: { topDepthM: number; baseDepthM: number },
  rightBand: { topDepthM: number; baseDepthM: number },
): string | null {
  const tally = new Map<string, number>()
  const order: string[] = []
  const add = (subs: readonly GeotechSubLayer[], band: { topDepthM: number; baseDepthM: number }): void => {
    for (const sl of subs) {
      const lo = Math.max(sl.topDepthM, band.topDepthM)
      const hi = Math.min(sl.baseDepthM, band.baseDepthM)
      const ov = hi - lo
      if (ov <= EPS) continue
      if (!tally.has(sl.formationId)) order.push(sl.formationId)
      tally.set(sl.formationId, (tally.get(sl.formationId) ?? 0) + ov)
    }
  }
  add(leftSubs, leftBand)
  add(rightSubs, rightBand)
  let best: string | null = null
  let bestOv = -1
  // Iterate in first-seen order so a tie resolves deterministically (shallower
  // sub-layer wins).
  for (const fid of order) {
    const ov = tally.get(fid) ?? 0
    if (ov > bestOv + EPS) {
      bestOv = ov
      best = fid
    }
  }
  return best
}

/** Min / max fraction + the top/base elevation at each of those two fractions. */
function bandEdges(polygon: readonly PartitionPoint[]): {
  leftFrac: number
  rightFrac: number
  topElevL: number
  baseElevL: number
  topElevR: number
  baseElevR: number
} {
  let leftFrac = Infinity
  let rightFrac = -Infinity
  for (const p of polygon) {
    if (p.fraction < leftFrac) leftFrac = p.fraction
    if (p.fraction > rightFrac) rightFrac = p.fraction
  }
  const elevAt = (frac: number): { top: number; base: number } => {
    let top = -Infinity
    let base = Infinity
    for (const p of polygon) {
      if (Math.abs(p.fraction - frac) > EPS) continue
      if (p.elevation > top) top = p.elevation
      if (p.elevation < base) base = p.elevation
    }
    return { top, base }
  }
  const l = elevAt(leftFrac)
  const r = elevAt(rightFrac)
  return {
    leftFrac,
    rightFrac,
    topElevL: l.top,
    baseElevL: l.base,
    topElevR: r.top,
    baseElevR: r.base,
  }
}

// ---------------------------------------------------------------------------
// R1 — per-sub-band band/onlap/lens using geotech correlation edges
// ---------------------------------------------------------------------------

/**
 * Build the geotech edge lookup: true iff an approved geotech packing correlation
 * edge directly connects geotech layer ids ``a`` and ``b``.
 *
 * Parameters
 * ----------
 * edges : readonly CorrelationEdge[]
 *     The approved geotech packing edges (``geotechPackingEdges``).
 *
 * Returns
 * -------
 * (a: string, b: string) => boolean
 *     Order-independent lookup.
 */
function buildGeotechCorrelated(
  edges: readonly CorrelationEdge[],
): (a: string, b: string) => boolean {
  const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const set = new Set<string>()
  for (const e of edges) {
    // Only top-keyed edges are used for the band/onlap/lens count (same as
    // classifyTermination's topCorr rule). Base-tie + mixed-tie variants are
    // rare on the geotech axis and deferred — if no aSide/bSide, it's top.
    const aIsTop = e.aSide === 'top' || e.aSide == null
    const bIsTop = e.bSide === 'top' || e.bSide == null
    if (aIsTop && bIsTop) set.add(edgeKey(e.a, e.b))
  }
  return (a, b) => set.has(edgeKey(a, b))
}

/**
 * The contact-correlation count (0/1/2) for one geotech sub-band toward a
 * given neighbour column's sub-bands.
 *
 * A geotech sub-band's TOP contact is keyed by its own ``layerId``; its BASE
 * contact is keyed by the layer immediately BELOW it (the next sub-band's
 * ``layerId``). A contact is correlated iff a geotech packing edge connects
 * either of those layer ids to any layer id on the neighbour column.
 *
 * Parameters
 * ----------
 * bands : readonly ColumnSubBand[]
 *     The sub-bands on one column (depth-ordered).
 * index : number
 *     The sub-band to classify.
 * neighbourLayerIds : ReadonlySet<string>
 *     Every ``layerId`` on the NEIGHBOUR column's sub-bands in this region.
 * correlated : (a: string, b: string) => boolean
 *     Top-keyed geotech edge lookup.
 *
 * Returns
 * -------
 * 0 | 1 | 2
 *     Number of correlated bounding contacts.
 */
function subBandCorrelationCount(
  bands: readonly ColumnSubBand[],
  index: number,
  neighbourLayerIds: ReadonlySet<string>,
  correlated: (a: string, b: string) => boolean,
): 0 | 1 | 2 {
  const id = bands[index].layerId
  const belowId = index + 1 < bands.length ? bands[index + 1].layerId : undefined

  const anyEdge = (lid: string): boolean => {
    for (const nid of neighbourLayerIds) if (correlated(lid, nid)) return true
    return false
  }

  let count = 0
  // Top contact. The FIRST sub-band's top IS the litho band's top — and this
  // function only runs inside a litho region that already spans both columns
  // (a quad), so that boundary is FRAMED by the litho correlation and counts as
  // tied. Interior sub-bands key the top contact on their own layerId (a geotech
  // packing edge). Without this framing the boundary sub-bands could never reach
  // count 2, so the bottom band of a fully-tied region wrongly onlapped instead
  // of banding (dogfeed 2026-06-25).
  if (index === 0 || (id !== undefined && anyEdge(id))) count++
  // Base contact. The LAST sub-band's base IS the litho band's base — also framed
  // by the spanning litho region. Interior sub-bands key the base contact on the
  // sub-band immediately below (its top is this band's base).
  if (index === bands.length - 1 || (belowId !== undefined && anyEdge(belowId))) count++
  return count as 0 | 1 | 2
}

/**
 * Subdivide a SINGLE quad litho region into geotech sub-band regions using the
 * per-sub-band band/onlap/lens logic (R1).
 *
 * Works entirely within the litho region's elevation span.  Each sub-band is
 * classified by its correlation count toward the neighbour column:
 *
 *   - **2** → BAND: 4-point quad spanning both columns' sub-band ranges.
 *   - **1** → ONLAP: triangle on this column, tip at ``INTERIOR_PINCH_FRACTION``
 *              on the correlated bracket interface.
 *   - **0** → LENS: triangle on this column, tip at ``LENS_PINCH_FRACTION``.
 *
 * Lenses and onlaps are emitted as overlay regions (``kind: 'lens'``) on top of
 * the enclosing band quad (the matrix), matching the litho partition model.
 *
 * Sub-bands that have no ``layerId`` (absent from the geotech layer response) are
 * treated as 0-correlated (lens) — a safe conservative fallback.
 *
 * Parameters
 * ----------
 * region : SectionRegion
 *     The parent litho quad region (must be ``kind: 'quad'``).
 * leftFrac, rightFrac : number
 *     The region's left / right column fractions in the gap's coordinate space.
 * leftBands, rightBands : readonly ColumnSubBand[]
 *     The clamped, depth-ordered sub-band stacks for the left and right columns.
 * leftSurf, rightSurf : number
 *     Surface elevations (mTAW) of the left and right columns.
 * correlated : (a: string, b: string) => boolean
 *     Geotech edge lookup.
 *
 * Returns
 * -------
 * SectionRegion[]
 *     The sub-band regions replacing the parent.  Always at least one entry.
 *     Main (band) quads come first; overlay (onlap/lens) triangles follow.
 */
function subdivideRegionR1(
  region: SectionRegion,
  leftFrac: number,
  rightFrac: number,
  leftBands: readonly ColumnSubBand[],
  rightBands: readonly ColumnSubBand[],
  leftSurf: number,
  rightSurf: number,
  correlated: (a: string, b: string) => boolean,
): SectionRegion[] {
  if (leftBands.length === 0 || rightBands.length === 0) return [region]

  // Precompute the neighbour layer-id sets for the correlation count.
  const leftLayerIds = new Set<string>(
    leftBands.map((b) => b.layerId).filter((id): id is string => id !== undefined),
  )
  const rightLayerIds = new Set<string>(
    rightBands.map((b) => b.layerId).filter((id): id is string => id !== undefined),
  )
  // Also add the "below" layer ids so the base-contact check reaches them.
  // (subBandCorrelationCount already loops rightLayerIds for belowId matching,
  //  so they must appear in the neighbour set — and they do since we add ALL ids.)

  const out: SectionRegion[] = []
  const overlays: SectionRegion[] = []
  // Right sub-bands consumed as the partner of a left BAND quad — recorded by
  // RIGHT layerId as we emit each band so the right-side loop below skips exactly
  // the partner it already drew (not "any right band whose id is in the left set",
  // which never matched and let a banded right partner re-emit a spurious overlay).
  const bandedRightLayerIds = new Set<string>()

  // --- Left column sub-bands toward the right neighbour ---
  for (let i = 0; i < leftBands.length; i++) {
    const lb = leftBands[i]
    const topL = leftSurf - lb.topDepthM
    const baseL = leftSurf - lb.baseDepthM
    const count = subBandCorrelationCount(leftBands, i, rightLayerIds, correlated)

    if (count === 2) {
      // BAND: find the matching right sub-band by elevation overlap and emit a quad.
      // Pick the right sub-band with the largest overlap with this left sub-band.
      let bestR = rightBands[0]
      let bestOv = -1
      for (const rb of rightBands) {
        const topR = rightSurf - rb.topDepthM
        const baseR = rightSurf - rb.baseDepthM
        const ov = Math.min(topL, topR) - Math.max(baseL, baseR)
        if (ov > bestOv) {
          bestOv = ov
          bestR = rb
        }
      }
      const topR = rightSurf - bestR.topDepthM
      const baseR = rightSurf - bestR.baseDepthM
      // Mark the right partner consumed so the right-side loop doesn't redraw it.
      if (bestR.layerId !== undefined) bandedRightLayerIds.add(bestR.layerId)
      out.push({
        ...region,
        formationId: lb.formationId,
        kind: 'quad',
        polygon: [
          { fraction: leftFrac, elevation: topL },
          { fraction: rightFrac, elevation: topR },
          { fraction: rightFrac, elevation: baseR },
          { fraction: leftFrac, elevation: baseL },
        ],
      })
    } else if (count === 1) {
      // ONLAP: determine which bracket it touches (top vs base).
      // "Top contact correlated" means the top bracket is tied → laps base up.
      // "Base contact correlated" (only) means the base bracket is tied → laps top down.
      const topId = lb.layerId
      // The top band's top contact is the litho band's top — framed by the spanning
      // litho region, so it counts as the tied bracket (laps up) even without a
      // geotech edge. Interior sub-bands look at the geotech edge on their own top.
      let topCorr = i === 0
      if (!topCorr && topId !== undefined) {
        for (const nid of rightLayerIds) {
          if (correlated(topId, nid)) {
            topCorr = true
            break
          }
        }
      }
      // Tip fraction: INTERIOR_PINCH_FRACTION into the gap from the left column.
      const tipFrac = leftFrac + INTERIOR_PINCH_FRACTION * (rightFrac - leftFrac)
      // Onlap triangle on the left column: the flat side is the full sub-band span on
      // the left column; the tip points toward the right at the correlated bracket's
      // elevation (topL when the top contact is tied; baseL when only the base is tied).
      // This is the same shape buildOnlapPolygon uses in the litho partition.
      overlays.push({
        ...region,
        formationId: lb.formationId,
        kind: 'lens' as const,
        overlayTier: 'onlap' as const,
        polygon: topCorr
          ? [
              // Top contact is correlated → tip at the top bracket elevation.
              { fraction: leftFrac, elevation: topL },
              { fraction: tipFrac, elevation: topL },
              { fraction: leftFrac, elevation: baseL },
            ]
          : [
              // Base contact is correlated → tip at the base bracket elevation.
              { fraction: leftFrac, elevation: topL },
              { fraction: tipFrac, elevation: baseL },
              { fraction: leftFrac, elevation: baseL },
            ],
      })
    } else {
      // LENS: left-column lens, pinches at LENS_PINCH_FRACTION toward the right.
      const apexFrac = leftFrac + LENS_PINCH_FRACTION * (rightFrac - leftFrac)
      const apexElev = (topL + baseL) / 2
      overlays.push({
        ...region,
        formationId: lb.formationId,
        kind: 'lens' as const,
        overlayTier: 'lens' as const,
        polygon: [
          { fraction: leftFrac, elevation: topL },
          { fraction: apexFrac, elevation: apexElev },
          { fraction: leftFrac, elevation: baseL },
        ],
      })
    }
  }

  // --- Right column sub-bands toward the left neighbour (for unmatched right bands) ---
  // Emit right-side lens/onlap for right sub-bands that are NOT already covered by a
  // left-column BAND (avoid double-emitting a band sub-quad). A right band is
  // "already banded" iff it is the very partner a left BAND quad consumed above —
  // tracked by right layerId in bandedRightLayerIds.
  for (let j = 0; j < rightBands.length; j++) {
    const rb = rightBands[j]
    if (rb.layerId !== undefined && bandedRightLayerIds.has(rb.layerId)) continue

    const topR = rightSurf - rb.topDepthM
    const baseR = rightSurf - rb.baseDepthM
    const count = subBandCorrelationCount(rightBands, j, leftLayerIds, correlated)

    if (count === 1) {
      // ONLAP from the right.
      const topId = rb.layerId
      // Top band's top is framed by the litho region (laps up) — same rule as left.
      let topCorr = j === 0
      if (!topCorr && topId !== undefined) {
        for (const nid of leftLayerIds) {
          if (correlated(topId, nid)) {
            topCorr = true
            break
          }
        }
      }
      const tipFrac = rightFrac - INTERIOR_PINCH_FRACTION * (rightFrac - leftFrac)
      overlays.push({
        ...region,
        formationId: rb.formationId,
        kind: 'lens' as const,
        overlayTier: 'onlap' as const,
        polygon: [
          { fraction: rightFrac, elevation: topR },
          { fraction: tipFrac, elevation: topCorr ? topR : baseR },
          { fraction: rightFrac, elevation: baseR },
        ],
      })
    } else if (count === 0) {
      // LENS from the right.
      const apexFrac = rightFrac - LENS_PINCH_FRACTION * (rightFrac - leftFrac)
      const apexElev = (topR + baseR) / 2
      overlays.push({
        ...region,
        formationId: rb.formationId,
        kind: 'lens' as const,
        overlayTier: 'lens' as const,
        polygon: [
          { fraction: rightFrac, elevation: topR },
          { fraction: apexFrac, elevation: apexElev },
          { fraction: rightFrac, elevation: baseR },
        ],
      })
    }
    // count === 2 is impossible for right-only loop (already handled from the left)
  }

  // If we only produced overlays (no bands at all) — which happens when every
  // sub-band lenses — just return the parent region to avoid an empty main layer.
  if (out.length === 0) return [region, ...overlays]
  return [...out, ...overlays]
}

/**
 * Subdivide each litho partition region into NAD sub-bands using the geotech
 * sub-layer depths on the two columns bounding the region's gap.
 *
 * A `quad` region whose two columns split the band into the SAME sequence of NAD
 * classes (same count, same NAD formation order, AND the same non-null resolver
 * ``body_id`` at each position) is cut into one sub-quad per class, split at the
 * paired (left, right) sub-layer boundaries — clean horizontal bands, the geotech
 * split surface being the straight line joining the two columns' split elevations.
 * Connection is therefore driven by the resolver's geotech ``body_id`` (spec §6),
 * not by local sequence equality: position-for-position the two columns must share
 * the same body to connect. Any other case (column mismatch, differing body,
 * pinch/lens region, or no sub-layer data) keeps the parent polygon and is
 * recoloured to the dominant NAD (or left at its litho formationId when no NAD
 * data exists).
 *
 * Parameters
 * ----------
 * regions : readonly SectionRegion[]
 *     The LITHO partition regions from `computeSectionFill` (carry `gapIndex`,
 *     `formationId` (litho), `bodyId`, `kind`, `polygon`).
 * orderedColumns : readonly PartitionColumn[]
 *     The litho columns in along-section order (index = column order; gap `i`
 *     is between column `i` and `i + 1`). Each carries `investigationId` +
 *     `surfaceElevM` for the depth↔elevation conversion.
 * subLayersByInv : ReadonlyMap<string, readonly GeotechSubLayer[]>
 *     `investigationId → its geotech NAD sub-layers` (depth-below-surface).
 * geotechEdges : readonly CorrelationEdge[], optional
 *     Approved geotech packing correlation edges (``geotechPackingEdges`` from
 *     ``SectionsCanvas``).  When present, enables R1 mode: each sub-band's
 *     shape toward the facing column is decided by how many of its TWO bounding
 *     contacts are tied by an edge (2 → band, 1 → onlap, 0 → lens), bounded
 *     strictly within the enclosing litho region.  When absent (or empty), the
 *     function falls back to R0 (all-or-nothing body_id connection).
 *
 * Returns
 * -------
 * SectionRegion[]
 *     The subdivided regions. `gapIndex` / `bodyId` / `kind` are preserved
 *     (sub-quads inherit the parent's). `formationId` is replaced by the NAD
 *     formation id (or kept as the litho id when no NAD data covers the body).
 */
export function subdivideRegionsByGeotech(
  regions: readonly SectionRegion[],
  orderedColumns: readonly PartitionColumn[],
  subLayersByInv: ReadonlyMap<string, readonly GeotechSubLayer[]>,
  geotechEdges?: readonly CorrelationEdge[],
): SectionRegion[] {
  // R1 activates whenever ``geotechEdges`` is provided (even empty — empty means
  // everything is 0-correlated, which produces lens overlays). R0 activates only
  // when ``geotechEdges`` is undefined (the caller did not supply an edge list).
  const r1Active = geotechEdges !== undefined
  const geotechCorrelated = r1Active ? buildGeotechCorrelated(geotechEdges!) : undefined

  const out: SectionRegion[] = []

  for (const region of regions) {
    const left = orderedColumns[region.gapIndex]
    const right = orderedColumns[region.gapIndex + 1]
    if (!left || !right) {
      out.push(region)
      continue
    }
    // SOIL MATCH: a region is subdivided ONLY by sub-layers derived from the same
    // litho formation (``sourceLithoFormationId === region.formationId``). Without
    // this, a clay band's depth range could overlap an adjacent sand sub-layer and
    // ``dominantNad`` would recolour the clay with a sand NAD colour (the wrong-soil
    // bug). The region's ``formationId`` here is still the LITHO formation (the
    // partition is built from litho layers); subdivision replaces it with the NAD id.
    const matchesSoil = (sl: GeotechSubLayer): boolean =>
      sl.sourceLithoFormationId === region.formationId
    const leftSubs = (subLayersByInv.get(left.investigationId) ?? []).filter(matchesSoil)
    const rightSubs = (subLayersByInv.get(right.investigationId) ?? []).filter(matchesSoil)

    const { leftFrac, rightFrac, topElevL, baseElevL, topElevR, baseElevR } = bandEdges(
      region.polygon,
    )

    // Band depth spans on each column (depth = surfaceElev − elevation).
    const leftBand = {
      topDepthM: left.surfaceElevM - topElevL,
      baseDepthM: left.surfaceElevM - baseElevL,
    }
    const rightBand = {
      topDepthM: right.surfaceElevM - topElevR,
      baseDepthM: right.surfaceElevM - baseElevR,
    }

    // Only a SIMPLE 4-vertex quad ([topL, topR, baseR, baseL]) with a real
    // two-column extent can be cleanly subdivided into stacked sub-quads. A quad
    // with extra vertices is a CLIPPED region (e.g. the deep-to-deep substrate
    // pass clips a quad above a shallow neighbour's TD, giving a sloped 5+-point
    // outline) — splitting it from only its left/right edges would not tile it,
    // so it falls back to a whole-region dominant-NAD recolour (shape preserved).
    const isQuad =
      region.kind === 'quad' && region.polygon.length === 4 && rightFrac - leftFrac > EPS
    const leftBands = isQuad ? columnSubBands(leftSubs, leftBand.topDepthM, leftBand.baseDepthM) : []
    const rightBands = isQuad
      ? columnSubBands(rightSubs, rightBand.topDepthM, rightBand.baseDepthM)
      : []

    // R1 mode: per-sub-band band/onlap/lens from geotech edges (owner directive
    // 2026-06-25). This replaces the R0 all-or-nothing ``sequencesMatch`` path
    // for any region where geotech edges are provided AND the region is a simple
    // quad with sub-layer data on at least one column.
    if (r1Active && isQuad && (leftBands.length > 0 || rightBands.length > 0)) {
      const subRegions = subdivideRegionR1(
        region,
        leftFrac,
        rightFrac,
        leftBands,
        rightBands,
        left.surfaceElevM,
        right.surfaceElevM,
        geotechCorrelated!,
      )
      out.push(...subRegions)
      continue
    }

    // R0 mode (fallback when no geotech edges):
    // Connection is the resolver's call: paired sub-bands connect only when they
    // share the same NAD formation AND the same non-null geotech ``body_id`` at
    // every aligned position (spec §6). A null body (resolver hasn't run / didn't
    // group them) never connects, so the region falls back to the whole-band
    // dominant-NAD recolour below.
    const sequencesMatch =
      isQuad &&
      leftBands.length >= 1 &&
      leftBands.length === rightBands.length &&
      leftBands.every(
        (b, i) =>
          b.formationId === rightBands[i].formationId &&
          b.bodyId != null &&
          b.bodyId === rightBands[i].bodyId,
      )

    if (sequencesMatch) {
      // Clean consistent split → one sub-quad per NAD class, split at the paired
      // (left, right) sub-layer boundaries. The split line joining the two
      // columns' split elevations IS the geotech split surface.
      for (let k = 0; k < leftBands.length; k += 1) {
        const lb = leftBands[k]
        const rb = rightBands[k]
        const topL = left.surfaceElevM - lb.topDepthM
        const baseL = left.surfaceElevM - lb.baseDepthM
        const topR = right.surfaceElevM - rb.topDepthM
        const baseR = right.surfaceElevM - rb.baseDepthM
        out.push({
          ...region,
          formationId: lb.formationId,
          polygon: [
            { fraction: leftFrac, elevation: topL },
            { fraction: rightFrac, elevation: topR },
            { fraction: rightFrac, elevation: baseR },
            { fraction: leftFrac, elevation: baseL },
          ],
        })
      }
      continue
    }

    // Fallback: keep the parent shape, recolour to the dominant NAD (or leave the
    // litho formationId when no NAD data covers this body). Never invents a wedge.
    const dom = dominantNad(leftSubs, rightSubs, leftBand, rightBand)
    out.push(dom === null ? region : { ...region, formationId: dom })
  }

  return out
}
