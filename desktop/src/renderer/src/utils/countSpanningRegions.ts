// How many partition regions span their whole gap — the one number that tells a
// BAND from an ONLAP or a LENS at a glance.
//
// Shared because two call sites log it: the section overlay (what the user SEES)
// and ``buildVoxelRequest`` (what the 3-D builder is GIVEN). Those two are
// documented to assemble identical columns through the same util, so when they
// disagree the difference is the whole answer — and comparing them is only
// meaningful if both count the same way. Second copy, so it lives here rather
// than inline (and it keeps the count out of the already-oversized overlay,
// debt #201).

import type { SectionRegion } from './sectionPartition'

/** A ring must reach within this of 0 and 1 to count as spanning its gap. */
const EDGE_TOL = 0.01

/**
 * Count the regions whose polygon reaches both column edges of its gap.
 *
 * @param regions - Partition regions from ``computeSectionFill`` / its v2 sibling.
 * @returns The number that span their gap (a band, as opposed to a wedge or lens).
 */
export function countSpanningRegions(regions: readonly SectionRegion[]): number {
  let n = 0
  for (const region of regions) {
    let lo = Infinity
    let hi = -Infinity
    for (const point of region.polygon) {
      if (point.fraction < lo) lo = point.fraction
      if (point.fraction > hi) hi = point.fraction
    }
    if (lo < EDGE_TOL && hi > 1 - EDGE_TOL) n += 1
  }
  return n
}
