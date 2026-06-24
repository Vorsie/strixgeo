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
 * The subdivision adds CLEAN HORIZONTAL sub-bands that span the whole body (a
 * consistent split), never spurious per-column wedges. When the two columns of a
 * gap disagree on the sub-band sequence (count or NAD order differ), the region
 * is kept WHOLE — one band, the dominant NAD — so no extra wedge is manufactured
 * from noise. This mirrors the geotech subdivision's policy B (split only where
 * packing changes vertically AND consistently across the body; lateral-only
 * variation → one representative class).
 *
 * Pure module — no React, no I/O, no `Date.now` / `Math.random`.
 */

import type { PartitionColumn, PartitionPoint, SectionRegion } from './partitionFill'

const EPS = 1e-6

/** One geotech NAD sub-layer on a column, in depth-below-surface metres. */
export interface GeotechSubLayer {
  topDepthM: number
  baseDepthM: number
  /** The geotech (NAD-class) formation id — drives the band colour + label. */
  formationId: string
}

/** A sub-band clamped + snapped to tile one column's slice of a litho band. */
interface ColumnSubBand {
  topDepthM: number
  baseDepthM: number
  formationId: string
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

/**
 * Subdivide each litho partition region into NAD sub-bands using the geotech
 * sub-layer depths on the two columns bounding the region's gap.
 *
 * A `quad` region whose two columns split the band into the SAME sequence of NAD
 * classes (same count, same formation order) is cut into one sub-quad per class,
 * split at the paired (left, right) sub-layer boundaries — clean horizontal
 * bands, the geotech split surface being the straight line joining the two
 * columns' split elevations. Any other case (column mismatch, pinch/lens region,
 * or no sub-layer data) keeps the parent polygon and is recoloured to the
 * dominant NAD (or left at its litho formationId when no NAD data exists).
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
): SectionRegion[] {
  const out: SectionRegion[] = []

  for (const region of regions) {
    const left = orderedColumns[region.gapIndex]
    const right = orderedColumns[region.gapIndex + 1]
    if (!left || !right) {
      out.push(region)
      continue
    }
    const leftSubs = subLayersByInv.get(left.investigationId) ?? []
    const rightSubs = subLayersByInv.get(right.investigationId) ?? []

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

    const sequencesMatch =
      isQuad &&
      leftBands.length >= 1 &&
      leftBands.length === rightBands.length &&
      leftBands.every((b, i) => b.formationId === rightBands[i].formationId)

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
