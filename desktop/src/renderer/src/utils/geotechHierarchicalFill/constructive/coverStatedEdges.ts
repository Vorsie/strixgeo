/**
 * WHOSE SHAPE IS THIS? — the litho cover's, or the geotech fill's own.
 *
 * The owner has now circled six geotech shapes he did not expect, and the
 * expensive part of each report is the same question every time: did the fill
 * DRAW that diagonal, or is it an edge of the litho unit the bands sit inside?
 * The two have completely different owners. A diagonal the fill drew is a
 * construct — a lens flank, an onlap flank, a tie — and the rulings about
 * triangles and quads apply to it. A diagonal the COVER states is the litho
 * stage's own approved geometry, which the geotech stage may never override
 * (*"a geotech band can never paint outside its parent litho soil geometry"* —
 * the structural invariant), and no geotech ruling reaches it.
 *
 * THE SHAPE THIS WAS CUT FOR (owner dogfeed 2026-08-25, Cross-section 3,
 * gap GEO-06/092-S2 → GEO-05/040-S6): a five-vertex ZAND|8 with *"flat top and
 * base to f=0.397, then an abrupt 2-segment pinch to apex (0.45,-0.39)"*, read
 * as a construct that terminated at the wrong fraction because its two
 * neighbours ended at 0.397 while it ended at 0.45. It is not a construct at
 * all: the litho cover there is a pinch-out triangle with its apex at 0.45, the
 * column carries THREE packing bands inside it, and a horizontal subdivision of
 * a triangle necessarily ends each band where the triangle's own flank crosses
 * that band's own contact. Only the band whose window straddles the apex
 * elevation reaches the apex. The owner's own contrast in the same screen —
 * *"SILT|16 closes as a clean triangle"* — is the one-band case of the very
 * same cover.
 *
 * So this module answers the question mechanically, and says nothing about
 * whether any shape is right: a region every one of whose sloping edges lies on
 * its gap's litho cover outline drew NO diagonal of its own, and the geotech
 * rulings have no jurisdiction over its silhouette.
 *
 * @module utils/geotechHierarchicalFill/constructive/coverStatedEdges
 */

import type { SectionRegion } from '../../sectionPartition'

/**
 * How far off a cover edge a vertex may sit and still count as on it.
 *
 * Rings arrive on the mm grid and a merged outline carries vertices the planar
 * arrangement placed by intersection, so a point ON a cover edge can miss it by
 * grid rounding. 1 mm in elevation, and the same number in fraction space,
 * which on a 60 m gap is 6 cm — an order below the shortest edge these shapes
 * carry and an order above the noise.
 */
const ON_EDGE_EPS = 1e-3

/** One edge of a ring, as its two endpoints. */
export interface RingEdge {
  a: { fraction: number; elevation: number }
  b: { fraction: number; elevation: number }
}

/**
 * The edges of a ring that change fraction AND elevation at once.
 *
 * Horizontal edges are a band's own mTAW contact and vertical ones are a gap
 * edge or the law's seam; neither is a shape. A silhouette is made of its
 * sloping edges, so those are the only ones whose authorship is in question.
 *
 * @param ring The region outline, in (fraction, elevation).
 * @param eps Smallest change on either axis that counts as sloping.
 * @returns One entry per sloping edge, in ring order.
 */
export function slopingEdges(
  ring: readonly { fraction: number; elevation: number }[],
  eps: number = ON_EDGE_EPS,
): RingEdge[] {
  const out: RingEdge[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (Math.abs(a.fraction - b.fraction) <= eps) continue
    if (Math.abs(a.elevation - b.elevation) <= eps) continue
    out.push({ a, b })
  }
  return out
}

/** Does ``p`` lie on the segment ``a``→``b``, within ``eps`` on both axes? */
function onSegment(
  p: { fraction: number; elevation: number },
  a: { fraction: number; elevation: number },
  b: { fraction: number; elevation: number },
  eps: number,
): boolean {
  const df = b.fraction - a.fraction
  const de = b.elevation - a.elevation
  const length = Math.hypot(df, de)
  if (length < eps) return false
  // Parameter of the closest point, clamped to the segment; a point past an end
  // is not on it however close the infinite line runs.
  const t = ((p.fraction - a.fraction) * df + (p.elevation - a.elevation) * de) / (length * length)
  if (t < -eps || t > 1 + eps) return false
  const clamped = Math.min(1, Math.max(0, t))
  return (
    Math.abs(a.fraction + clamped * df - p.fraction) <= eps &&
    Math.abs(a.elevation + clamped * de - p.elevation) <= eps
  )
}

/**
 * Is this sloping edge one the litho cover already states?
 *
 * Both endpoints must lie on ONE cover edge — a segment whose two ends happen
 * to sit on two different cover edges is a chord across the cover, which is a
 * line the fill drew.
 *
 * @param edge The sloping edge to place.
 * @param coverRings The litho cover outlines of the same gap.
 * @param eps Placement tolerance; defaults to the module's own.
 * @returns Whether the cover states it.
 */
export function isCoverStated(
  edge: RingEdge,
  coverRings: readonly (readonly { fraction: number; elevation: number }[])[],
  eps: number = ON_EDGE_EPS,
): boolean {
  for (const ring of coverRings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      if (onSegment(edge.a, a, b, eps) && onSegment(edge.b, a, b, eps)) return true
    }
  }
  return false
}

/** One region's authorship verdict. */
export interface ShapeAuthorship {
  region: SectionRegion
  /** Its sloping edges the litho cover already states. */
  coverStated: RingEdge[]
  /** Its sloping edges the cover does NOT state — lines the fill drew. */
  ownDiagonals: RingEdge[]
}

/**
 * Place every region's sloping edges against its gap's litho cover.
 *
 * @param regions The emitted geotech regions.
 * @param coverByGap Gap index → that gap's litho cover outlines.
 * @param eps Placement tolerance; defaults to the module's own.
 * @returns One verdict per region that has at least one sloping edge; regions
 *   made only of horizontals and verticals are omitted, having no silhouette to
 *   attribute.
 */
export function shapeAuthorship(
  regions: readonly SectionRegion[],
  coverByGap: ReadonlyMap<number, readonly (readonly { fraction: number; elevation: number }[])[]>,
  eps: number = ON_EDGE_EPS,
): ShapeAuthorship[] {
  const out: ShapeAuthorship[] = []
  for (const region of regions) {
    const sloping = slopingEdges(region.polygon, eps)
    if (sloping.length === 0) continue
    const rings = coverByGap.get(region.gapIndex) ?? []
    const coverStated: RingEdge[] = []
    const ownDiagonals: RingEdge[] = []
    for (const edge of sloping) {
      if (isCoverStated(edge, rings, eps)) coverStated.push(edge)
      else ownDiagonals.push(edge)
    }
    out.push({ region, coverStated, ownDiagonals })
  }
  return out
}
