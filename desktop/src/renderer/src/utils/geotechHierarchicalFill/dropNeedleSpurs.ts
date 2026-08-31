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
 * MEASURED IN TRUE METRES (owner code-hunt finding F6, 2026-08-22): a ring's
 * vertices are (fraction, elevation) — a dimensionless gap-fraction and a
 * metre elevation, two different units. The original measure compared them
 * directly, which made the "is this thin" test 300× more permissive for a
 * near-horizontal spur than a near-vertical one (a purely horizontal spur's
 * measure reduces to twice its elevation height, independent of how far it
 * runs; a purely vertical spur's reduces to its fraction width, independent
 * of height) — an accident of the units, not a considered choice. Every
 * function here now takes the gap's own width in metres and converts
 * fraction to along-section metres before measuring, so "thin" means the
 * same thing in every direction.
 *
 * Pure module — no I/O, no React.
 *
 * @module utils/geotechHierarchicalFill/dropNeedleSpurs
 */

import type { SectionRegion } from '../sectionPartition'

/**
 * How thin an out-and-back detour must be to count as a needle, in METRES —
 * comparable directly against elevation, once fraction is converted to
 * along-section metres by the gap's own width.
 *
 * The backend's own minimum layer thickness is 1 mm (BE clamp,
 * ``docs/data-integrity.md`` / the project's schema rules) — a legally
 * created, real band can be exactly that thin. The owner's own circled spur
 * on B3|S9, measured in true metres at its real gap's own width, is 0.505 mm
 * — so the threshold has to clear THAT with margin too, not just sit under
 * the legal ceiling. 0.7 mm splits the difference: ~40% above the measured
 * defect, ~30% below the legal minimum.
 */
export const NEEDLE_WIDTH_M = 7e-4

/** A ring vertex. */
interface P {
  fraction: number
  elevation: number
}

/** A ring vertex converted to (along-section metres, elevation metres). */
function toMetres(p: P, gapWidthM: number): { x: number; y: number } {
  return { x: p.fraction * gapWidthM, y: p.elevation }
}

/**
 * Drop every out-and-back needle from one ring.
 *
 * A vertex is a needle apex when the path REVERSES there (the incoming and
 * outgoing edges point in opposing directions) and the triangle it makes with
 * its neighbours is thinner than {@link NEEDLE_WIDTH_M}, measured in true
 * metres both directions. Removal repeats until the ring is stable, because a
 * spur can nest inside a spur. A ring is never reduced below three vertices.
 *
 * @param ring The closed ring, in (fraction, elevation).
 * @param gapWidthM The gap's own along-section width, in metres — converts
 *   fraction to a real distance so the measure is isotropic.
 * @returns The ring without its needles — the same array when nothing changed.
 */
export function dropNeedleSpurs(ring: readonly P[], gapWidthM: number): readonly P[] {
  if (ring.length < 4) return ring
  const width = Math.abs(gapWidthM)
  let points = [...ring]
  let changed = true
  while (changed && points.length > 3) {
    changed = false
    for (let i = 0; i < points.length; i++) {
      const prev = toMetres(points[(i - 1 + points.length) % points.length], width)
      const here = toMetres(points[i], width)
      const next = toMetres(points[(i + 1) % points.length], width)
      const inX = here.x - prev.x
      const inY = here.y - prev.y
      const outX = next.x - here.x
      const outY = next.y - here.y
      // A REVERSAL, not a corner: the outgoing edge heads back the way the
      // incoming edge came. This is a cheap pre-filter, not the safety net —
      // the metre-scale area test below is what actually protects a real,
      // sharp corner (a genuine wedge apex reverses just as hard as a spur
      // does; only its SIZE tells them apart).
      if (inX * outX + inY * outY >= 0) continue
      const twiceArea = Math.abs(inX * outY - inY * outX)
      const longest = Math.max(Math.hypot(inX, inY), Math.hypot(outX, outY))
      if (longest <= 0) continue
      if (twiceArea / longest > NEEDLE_WIDTH_M) continue
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
 * The same measure as a spur's, applied to the ring itself: a sliver whose
 * true metre width is a fraction of a millimetre paints nothing a screen can
 * show, but its own outline stroke draws the very hairline this module exists
 * to remove. Measured model-wide on the owner's CS1: four such regions,
 * 0.0016 m² of "ground" between them.
 *
 * @param ring The region's ring.
 * @param gapWidthM The gap's own along-section width, in metres.
 * @returns ``true`` when the ring is thinner than {@link NEEDLE_WIDTH_M}.
 */
export function isNeedleRegion(ring: readonly P[], gapWidthM: number): boolean {
  if (ring.length < 3) return true
  const width = Math.abs(gapWidthM)
  let twice = 0
  let longest = 0
  for (let i = 0; i < ring.length; i++) {
    const a = toMetres(ring[i], width)
    const b = toMetres(ring[(i + 1) % ring.length], width)
    twice += a.x * b.y - b.x * a.y
    longest = Math.max(longest, Math.hypot(b.x - a.x, b.y - a.y))
  }
  if (longest <= 0) return true
  return Math.abs(twice) / longest <= NEEDLE_WIDTH_M
}

/**
 * De-needle every region and drop the ones that ARE needles.
 *
 * @param regions The finished regions.
 * @param alongM Along-section metres of every frame column — the source of
 *   each region's own gap width.
 * @returns The regions with de-needled polygons, sliver debris removed.
 */
export function dropRegionNeedles(
  regions: readonly SectionRegion[],
  alongM: readonly number[],
): SectionRegion[] {
  const out: SectionRegion[] = []
  for (const region of regions) {
    const gapWidthM = (alongM[region.gapIndex + 1] ?? 0) - (alongM[region.gapIndex] ?? 0)
    const polygon = dropNeedleSpurs(region.polygon, gapWidthM)
    if (isNeedleRegion(polygon, gapWidthM)) continue
    out.push(polygon === region.polygon ? region : { ...region, polygon: [...polygon] })
  }
  return out
}
