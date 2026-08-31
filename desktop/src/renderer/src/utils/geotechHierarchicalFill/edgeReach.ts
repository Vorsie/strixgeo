/**
 * THE CLAMPED-EDGE TRIPWIRE — a gap that emits fill must be readable at its
 * two column edges.
 *
 * WHAT THE 3-D BUILD DOES WITH A GAP'S EDGE. The backend samples a section's
 * stack at a gap-local fraction, and it cannot sample at exactly 0 or 1: the
 * 2-D engine snaps every coordinate to a 1 mm grid in METRES, so a region drawn
 * all the way across a gap lands at 0.99991 on an 11 m gap and 0.999994 on a
 * 333 m one. It therefore insets the query by two snap cells expressed in that
 * gap's OWN fraction space (``snap_grid.gap_edge_fraction_margin``, debt #259).
 * If the fill does not reach even that inset line, the section reports an EMPTY
 * column there, and ``label_voxels`` quietly defers to the neighbouring section
 * and extrudes it alone — a whole section's contribution dropped without a
 * word.
 *
 * WHY IT IS A TRIPWIRE AND NOT A FIX. The tempting repair — clamp the query
 * into whatever envelope the polygons happen to reach, or nudge every emitted
 * edge onto the column — was REJECTED deliberately when #259 was closed: it
 * drags a region that genuinely ends mid-gap, a lens pinching out, all the way
 * to the test, which is inventing geology to paper over a rounding artefact.
 * So the invariant is stated against the LITHO COVER, which is the only
 * authority on where this gap's ground actually ends: the classed fill must be
 * readable wherever the cover is, and nowhere else is it owed anything.
 *
 * WHAT THIS COSTS TO GET WRONG, and why the check is worth its lines: the claim
 * "the geotech payload stops 25 mm short on 2 of 69 gaps" has now been raised
 * twice, refuted twice by hand, and both times the refutation was an argument
 * about a denominator (a shortfall divided by the SECTION length rather than
 * the GAP width reads 100x too large on a narrow gap). An argument does not
 * survive the next session. This does.
 *
 * Pure module — regions and a column axis in, violations out.
 *
 * @module utils/geotechHierarchicalFill/edgeReach
 */

import { slicePolygonAtFraction } from '../sectionPartition/sectionRegion'
import { SNAP_GRID_M } from '../partitionFillV2/types'
import type { SectionRegion } from '../sectionPartition'

/**
 * How many snap cells the build's query is inset by.
 *
 * MIRRORS ``SNAP_MARGIN_CELLS`` in
 * ``groundmodel.domain.services.voxel_litho.snap_grid`` — the two must agree or
 * this tripwire watches a line the build never samples. Two rather than one
 * because a coordinate can be snapped away from the column edge by up to a full
 * cell and the scanline then has to land strictly inside what is left.
 */
export const EDGE_MARGIN_CELLS = 2

/** Fraction resolution floor, mirroring the backend's ``FRACTION_EPS``. */
const FRACTION_EPS = 1e-6

/** Elevation (m) below which a slice counts as holding nothing. */
const EMPTY_EXTENT_M = 1e-9

/** One gap the classed fill cannot be read at, at one of its two edges. */
export interface EdgeReachViolation {
  /** The frame gap it stands on. */
  gapIndex: number
  /** 0 = the gap's left column, 1 = its right column. */
  edge: 0 | 1
  /** The gap-local fraction the build samples at — where the read came back empty. */
  fraction: number
  /** Elevation the litho cover holds there, in metres. */
  coverM: number
  /** Elevation the classed fill holds there, in metres — zero, by definition. */
  filledM: number
}

/**
 * The two gap-local fractions the 3-D build samples a gap's edges at.
 *
 * @param widthM The gap's width in metres.
 * @returns ``[near, far]`` — both strictly inside ``(0, 1)`` and strictly
 *   ordered around the midpoint, however degenerate the gap. A pair of stations
 *   1 mm apart would otherwise produce a margin past its own midpoint and the
 *   two clamps would cross, which is #259's own signature reached through
 *   #259's own fix.
 */
export function clampedEdgeFractions(widthM: number): [number, number] {
  if (!(widthM > 0)) return [FRACTION_EPS, 1 - FRACTION_EPS]
  const raw = Math.max(FRACTION_EPS, (EDGE_MARGIN_CELLS * SNAP_GRID_M) / widthM)
  const margin = Math.min(raw, 0.5 - FRACTION_EPS)
  return [margin, 1 - margin]
}

/** Total elevation the regions hold on the vertical line at ``fraction``. */
function extentAt(regions: readonly SectionRegion[], fraction: number): number {
  const spans: [number, number][] = []
  for (const region of regions) {
    for (const span of slicePolygonAtFraction(region.polygon, fraction)) spans.push(span)
  }
  if (spans.length === 0) return 0
  // Union, not sum: the fill's faces are disjoint but the litho cover's are not
  // always (an overlay tier paints over its host), and double-counting the
  // cover would make the tripwire compare two different quantities.
  spans.sort((a, b) => a[0] - b[0])
  let total = 0
  let [lo, hi] = spans[0]
  for (let i = 1; i < spans.length; i++) {
    const [a, b] = spans[i]
    if (a > hi) {
      total += hi - lo
      lo = a
      hi = b
    } else if (b > hi) hi = b
  }
  return total + (hi - lo)
}

/** Group regions by the gap they stand on. */
function byGap(regions: readonly SectionRegion[]): Map<number, SectionRegion[]> {
  const out = new Map<number, SectionRegion[]>()
  for (const region of regions) {
    const list = out.get(region.gapIndex)
    if (list === undefined) out.set(region.gapIndex, [region])
    else list.push(region)
  }
  return out
}

/**
 * Which gaps emit fill the 3-D build cannot read at a column edge.
 *
 * A gap is in violation when it has classed faces, its litho cover holds ground
 * at the clamped edge fraction, and the classed faces hold none. A gap with no
 * classed faces at all is BLANK, not short — an un-divided column blanks its two
 * flanking gaps by ruling (2026-08-15), the same scope-out
 * ``fillTotality.ts`` makes — and a gap whose cover itself ends before the
 * column is followed, not corrected.
 *
 * @param regions The classed faces, on the frame's gap axis — what the build's
 *   payload actually carries.
 * @param lithoRegions The litho frame's own partition, same axis — the
 *   authority on where this gap's ground ends.
 * @param alongM Along-section metres per frame column, so each gap's margin is
 *   computed in its own fraction space.
 * @returns One entry per (gap, edge) that reads empty; empty when every gap
 *   that emits is readable at both its edges.
 */
export function edgeReachViolations(
  regions: readonly SectionRegion[],
  lithoRegions: readonly SectionRegion[],
  alongM: readonly number[],
): EdgeReachViolation[] {
  const out: EdgeReachViolation[] = []
  const filled = byGap(regions)
  const cover = byGap(lithoRegions)
  for (const [gapIndex, faces] of [...filled].sort((a, b) => a[0] - b[0])) {
    const xa = alongM[gapIndex]
    const xb = alongM[gapIndex + 1]
    if (xa === undefined || xb === undefined) continue
    const coverFaces = cover.get(gapIndex) ?? []
    if (coverFaces.length === 0) continue
    const fractions = clampedEdgeFractions(Math.abs(xb - xa))
    for (let edge = 0; edge < 2; edge++) {
      const fraction = fractions[edge]
      const filledM = extentAt(faces, fraction)
      if (filledM > EMPTY_EXTENT_M) continue
      const coverM = extentAt(coverFaces, fraction)
      if (coverM <= EMPTY_EXTENT_M) continue
      out.push({ gapIndex, edge: edge as 0 | 1, fraction, coverM, filledM })
    }
  }
  return out
}
