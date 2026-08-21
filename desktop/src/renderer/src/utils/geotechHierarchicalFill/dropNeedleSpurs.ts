/**
 * Remove NEEDLE SPURS from a finished region ring.
 *
 * Owner, 2026-08-21 late night, pointing at a short pale near-vertical line in
 * the middle of a silt mass on the B3|S9 gap: *"it is all silted, the crack
 * has a boundary at the bottom but not at the top, it shouldn't be there, no
 * holes in the model remember."*
 *
 * It is not a hole — the geometric audit (``geotechHoles.diag``) finds zero
 * unpainted ground model-wide. It is the ring's own outline: where a wedge
 * flank and the line it closes onto are nearly collinear, the merged ring
 * walks OUT to the apex and back along almost the same path, enclosing
 * essentially no area. The fill of such a spur is invisible (zero width) but
 * the seam-stroke pass has no neighbour to match against those two edges, so
 * it strokes them — one hairline running from the region's boundary to a point
 * in mid-region, ending in nothing. That is exactly "a boundary at the bottom
 * but not at the top".
 *
 * The spur carries no ground, so dropping its apex changes no area and no
 * class — it only stops the outline from doubling back on itself.
 *
 * Pure module — no I/O, no React.
 *
 * @module utils/geotechHierarchicalFill/dropNeedleSpurs
 */

import type { SectionRegion } from '../partitionFill'

/**
 * How thin an out-and-back detour must be to count as a needle.
 *
 * Measured as ``2 × area / longest edge`` in the ring's own (fraction,
 * elevation) units — a degeneracy test, not a physical width, which is why
 * the mixed units are acceptable here. The real spur on the owner's B3|S9
 * silt measures 1.7e-4; the thinnest feature the engine draws on purpose (a
 * pinch wedge at its apex end) is its own region, not a detour inside one,
 * and is orders of magnitude wider where it still has vertices. 1e-3 sits
 * ~6× above the observed spur and far below anything meant to be seen.
 */
export const NEEDLE_WIDTH = 1e-3

/** A ring vertex. */
interface P {
  fraction: number
  elevation: number
}

/**
 * Drop every out-and-back needle from one ring.
 *
 * A vertex is a needle apex when the path REVERSES there (the incoming and
 * outgoing edges point in opposing directions) and the triangle it makes with
 * its neighbours is thinner than {@link NEEDLE_WIDTH}. Removal repeats until
 * the ring is stable, because a spur can nest inside a spur. A ring is never
 * reduced below three vertices.
 *
 * @param ring The closed ring, in (fraction, elevation).
 * @returns The ring without its needles — the same array when nothing changed.
 */
export function dropNeedleSpurs(ring: readonly P[]): readonly P[] {
  if (ring.length < 4) return ring
  let points = [...ring]
  let changed = true
  while (changed && points.length > 3) {
    changed = false
    for (let i = 0; i < points.length; i++) {
      const prev = points[(i - 1 + points.length) % points.length]
      const here = points[i]
      const next = points[(i + 1) % points.length]
      const inX = here.fraction - prev.fraction
      const inY = here.elevation - prev.elevation
      const outX = next.fraction - here.fraction
      const outY = next.elevation - here.elevation
      // A REVERSAL, not a corner: the outgoing edge heads back the way the
      // incoming edge came. Without this a legitimate sharp convex corner of
      // a thin wedge would qualify on area alone.
      if (inX * outX + inY * outY >= 0) continue
      const twiceArea = Math.abs(inX * outY - inY * outX)
      const longest = Math.max(Math.hypot(inX, inY), Math.hypot(outX, outY))
      if (longest <= 0) continue
      if (twiceArea / longest > NEEDLE_WIDTH) continue
      points.splice(i, 1)
      changed = true
      break
    }
  }
  return points.length === ring.length ? ring : points
}

/**
 * How thin a WHOLE region is before it is snap debris rather than ground.
 *
 * The same measure as a spur's, applied to the ring itself: a three-vertex
 * sliver whose width is a ten-thousandth of the gap paints nothing a screen
 * can show, but its own outline stroke draws the very hairline this module
 * exists to remove. Measured model-wide on the owner's CS1: four such regions,
 * 0.0016 m² of "ground" between them.
 *
 * @param ring The region's ring.
 * @returns ``true`` when the ring is thinner than {@link NEEDLE_WIDTH}.
 */
export function isNeedleRegion(ring: readonly P[]): boolean {
  if (ring.length < 3) return true
  let twice = 0
  let longest = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    twice += a.fraction * b.elevation - b.fraction * a.elevation
    longest = Math.max(longest, Math.hypot(b.fraction - a.fraction, b.elevation - a.elevation))
  }
  if (longest <= 0) return true
  return Math.abs(twice) / longest <= NEEDLE_WIDTH
}

/**
 * De-needle every region and drop the ones that ARE needles.
 *
 * @param regions The finished regions.
 * @returns The regions with de-needled polygons, sliver debris removed.
 */
export function dropRegionNeedles(regions: readonly SectionRegion[]): SectionRegion[] {
  const out: SectionRegion[] = []
  for (const region of regions) {
    const polygon = dropNeedleSpurs(region.polygon)
    if (isNeedleRegion(polygon)) continue
    out.push(polygon === region.polygon ? region : { ...region, polygon: [...polygon] })
  }
  return out
}
