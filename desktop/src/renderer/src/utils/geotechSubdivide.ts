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
 * ### Packing band/onlap/lens carve (R1 — owner directive 2026-06-25, rebuilt 2026-06-26)
 *
 * When ``geotechEdges`` are passed, each quad litho region is CARVED into its NAD
 * packing sub-bands by running the proven litho partition engine
 * (``computeSectionFill``) on the region's two sub-band stacks, bounded PER litho
 * region. The engine produces a true PARTITION — it bands matching stacks, pinches
 * a unit present on one column only, and carves an enclosed lens out of its
 * surrounding matrix, all tiling the gap with no holes. This is the owner's
 * "litho body is the matrix, carve the packing densities into it" model.
 *
 * Why the engine, not a hand-roll: the first R1 hand-rolled the onlap/lens as lone
 * triangles with no matrix behind them, so every pinch punched a hole (dogfeed
 * 2026-06-25 "gaps appeared"). Running the engine PER region (never whole-section)
 * keeps the litho frame and sidesteps the 187-singleton trap (a whole-section
 * geotech ``computeSectionFill``). The litho-as-matrix no-gap guarantee comes from
 * the engine's partition property plus the R0 dominant-NAD recolour fallback for
 * any region the carve can't run on (non-quad, or missing sub-bands on a column).
 *
 * Pure module — no React, no I/O, no `Date.now` / `Math.random`.
 */

import type {
  CorrelationEdge,
  PartitionColumn,
  PartitionPoint,
  PartitionUnit,
  SectionRegion,
} from './partitionFill'
import { computeSectionFill } from './partitionFill'

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
// R1 — carve each litho region into packing bands/onlaps/lenses via the proven
// litho partition engine (computeSectionFill), bounded PER litho region.
// ---------------------------------------------------------------------------

/**
 * Carve ONE quad litho region into geotech NAD packing sub-regions by running the
 * litho partition engine on the region's two sub-band stacks.
 *
 * Why reuse ``computeSectionFill`` instead of hand-rolling band/onlap/lens
 * -----------------------------------------------------------------------
 * The engine produces a true PARTITION (tiles the gap, no holes) and already
 * knows how to band matching stacks, pinch a unit present on one column only, and
 * carve an enclosed lens out of its surrounding matrix. The earlier hand-rolled
 * R1 emitted a pinching sub-band as a lone triangle with no matrix behind it, so
 * every onlap/lens punched a hole (dogfeed 2026-06-25 "gaps appeared"). Running
 * the engine PER litho region (never whole-section) keeps the litho frame and
 * avoids the 187-singleton trap (a whole-section geotech ``computeSectionFill``).
 *
 * The two synthetic columns are built from the region's clamped sub-band stacks
 * (``columnSubBands`` already snapped them to tile the region's depth). The engine
 * returns regions in (fraction ∈ [0,1], absolute-elevation) space for its single
 * gap; we remap ``fraction`` into the parent region's [leftFrac, rightFrac] and
 * inherit the parent's ``gapIndex`` / ``bodyId`` so the overlay places + groups
 * them correctly.
 *
 * Parameters
 * ----------
 * region : SectionRegion
 *     The parent litho quad region.
 * leftFrac, rightFrac : number
 *     The region's left / right column fractions (0 / 1 for a full-gap quad).
 * leftBands, rightBands : readonly ColumnSubBand[]
 *     The clamped, depth-ordered NAD sub-band stacks (both non-empty).
 * left, right : PartitionColumn
 *     The bounding columns (for ``investigationId`` + ``surfaceElevM``).
 * edges : readonly CorrelationEdge[]
 *     Approved geotech packing edges (keyed by geotech ``layerId``).
 *
 * Returns
 * -------
 * SectionRegion[]
 *     The carved sub-regions tiling the parent (mains + lens overlays), or `[]`
 *     when the engine produced nothing (caller falls back to a dominant recolour).
 */
function carveRegionByGeotech(
  region: SectionRegion,
  leftFrac: number,
  rightFrac: number,
  leftBands: readonly ColumnSubBand[],
  rightBands: readonly ColumnSubBand[],
  left: PartitionColumn,
  right: PartitionColumn,
  edges: readonly CorrelationEdge[],
): SectionRegion[] {
  // A sub-band with no geotech layer id is uncorrelated; give it a synthetic
  // stable id so PartitionUnit is well-formed and NO edge can ever match it.
  const toUnits = (bands: readonly ColumnSubBand[], invId: string): PartitionUnit[] =>
    bands.map((b, i) => ({
      topDepthM: b.topDepthM,
      baseDepthM: b.baseDepthM,
      formationId: b.formationId,
      bodyId: b.bodyId,
      layerId: b.layerId ?? `geo:${invId}:${i}`,
    }))

  const leftCol: PartitionColumn = {
    investigationId: left.investigationId,
    surfaceElevM: left.surfaceElevM,
    units: toUnits(leftBands, left.investigationId),
  }
  const rightCol: PartitionColumn = {
    investigationId: right.investigationId,
    surfaceElevM: right.surfaceElevM,
    units: toUnits(rightBands, right.investigationId),
  }

  // One gap, fraction 0 = left, 1 = right. alongM [0, 1] only affects pinch-tip
  // placement, not topology. No apex overrides (no geotech sub-lens freedraw yet).
  const carved = computeSectionFill([leftCol, rightCol], edges, new Map(), [0, 1])
  const span = rightFrac - leftFrac
  return carved.map((r) => ({
    ...r,
    gapIndex: region.gapIndex,
    bodyId: region.bodyId,
    polygon: r.polygon.map((p) => ({
      fraction: leftFrac + p.fraction * span,
      elevation: p.elevation,
    })),
  }))
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
 *     ``SectionsCanvas``).  When present, enables R1 mode: each quad region is
 *     CARVED into its NAD packing sub-bands by running ``computeSectionFill`` on
 *     the region's two sub-band stacks (bands matching stacks, pinches a unit
 *     present on one column only, carves an enclosed lens out of its matrix — a
 *     true gap-free partition), bounded strictly within the enclosing litho
 *     region. When absent, the function uses R0 (all-or-nothing body_id
 *     connection). An empty array still enables R1 (the carve then bands by
 *     geometry where stacks match, pinches where they differ).
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

    // R1 mode: carve the region into packing bands/onlaps/lenses via the litho
    // partition engine, bounded per region (owner directive 2026-06-25; rebuilt
    // gap-free 2026-06-26). Needs sub-band data on BOTH columns to form a 2-column
    // partition; otherwise fall through to the R0 dominant-NAD recolour (gap-free).
    if (r1Active && isQuad && leftBands.length > 0 && rightBands.length > 0) {
      const subRegions = carveRegionByGeotech(
        region,
        leftFrac,
        rightFrac,
        leftBands,
        rightBands,
        left,
        right,
        geotechEdges!,
      )
      if (subRegions.length > 0) {
        out.push(...subRegions)
        continue
      }
      // Engine produced nothing — fall through to the dominant-NAD recolour.
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
