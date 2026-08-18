/**
 * THE LEVEL FILL — what a family's own cover reads where its partition is silent.
 *
 * The partition engine answers a gap from the two columns that flank it. Inside
 * ONE family it is often silent over part of that family's own litho cover:
 *
 *  * the family reaches only one side of the gap — its litho unit pinches out
 *    (an onlap or a lens; 30 of Cross-section 1's 47 families are anchored on a
 *    single test), so there is no gap for the engine to partition at all;
 *  * the litho frame gave the family a face its own two units do not bracket —
 *    the litho engine painted it by flooding the vacancy a NEIGHBOURING
 *    lithology left, and inside a family run there is no neighbour to displace,
 *    so nothing is emitted there.
 *
 * Both are answered by the 2/1/0 law's third case, in the owner's own words: an
 * untied band closes AT ITS OWN LEVEL. So the silent cover is cut at the
 * flanking tests' band boundaries and each slice takes the band that test read
 * at that level — the nearer test first, the other one when the nearer never
 * reached that depth. Nothing is invented: the extent is the litho model's, the
 * levels are measured on the columns, and the band can only ever be one of the
 * family's own — so the soil is right by construction.
 *
 * A slice at a level NEITHER test read keeps no class. It stays residual and the
 * render answers it with the litho colour under the "correlate me" texture,
 * which is the truth: nothing was derived there.
 *
 * @module utils/geotechHierarchicalFill/levelFill
 */

import { overlayFaces, pointInRing } from './frameClipGeometry'
import type { PartitionColumn, SectionRegion } from '../partitionFill'

/** One band of a flanking column, in absolute elevation. */
export interface LevelBand {
  formationId: string
  bodyId: string | null
  layerId: string
  topElev: number
  baseElev: number
}

/**
 * One column's family bands as elevation intervals.
 *
 * @param column The column, already reduced to one family's bands.
 * @returns The bands, shallowest first.
 */
export function levelBands(column: PartitionColumn | undefined): LevelBand[] {
  if (column === undefined) return []
  return [...column.units]
    .sort((a, b) => a.topDepthM - b.topDepthM)
    .map((u) => ({
      formationId: u.formationId,
      bodyId: u.bodyId,
      layerId: u.layerId,
      topElev: column.surfaceElevM - u.topDepthM,
      baseElev: column.surfaceElevM - u.baseDepthM,
    }))
}

/** The band of ``bands`` whose interval contains ``elevation``, or null. */
function bandAt(bands: readonly LevelBand[], elevation: number): LevelBand | null {
  for (const band of bands) {
    if (elevation <= band.topElev && elevation >= band.baseElev) return band
  }
  return null
}

/**
 * Read the silent parts of a family's cover off the flanking tests' band levels.
 *
 * @param silent The cover the family's partition did not classify — whole litho
 *   regions when the engine emitted nothing in the gap, or the residual faces
 *   the clip left.
 * @param left The family's bands on the gap's LEFT column.
 * @param right The family's bands on the gap's RIGHT column.
 * @param gapIndex The frame gap index stamped on every emitted region.
 * @param sameLithology The flanks' bands of the SAME lithology from ANY chain —
 *   the last resort for cover no chain with densities claims (sub-TD substrate,
 *   a body whose own tests were never divided that deep). Omit to refuse it.
 * @returns Classed slices, whatever no test read at all, and the subset of the
 *   classed slices that came from the last resort (reported, never silent).
 */
export function fillByLevel(
  silent: readonly SectionRegion[],
  left: readonly LevelBand[],
  right: readonly LevelBand[],
  gapIndex: number,
  sameLithology?: { left: readonly LevelBand[]; right: readonly LevelBand[] },
): { covered: SectionRegion[]; residual: SectionRegion[]; crossFamily: SectionRegion[] } {
  const crossFamily: SectionRegion[] = []
  if (silent.length === 0) return { covered: [], residual: [], crossFamily }
  const kinLeft = sameLithology?.left ?? []
  const kinRight = sameLithology?.right ?? []
  if (left.length === 0 && right.length === 0 && kinLeft.length === 0 && kinRight.length === 0) {
    return { covered: [], residual: [...silent], crossFamily }
  }

  let fLo = Infinity
  let fHi = -Infinity
  let eLo = Infinity
  let eHi = -Infinity
  for (const region of silent) {
    for (const p of region.polygon) {
      if (p.fraction < fLo) fLo = p.fraction
      if (p.fraction > fHi) fHi = p.fraction
      if (p.elevation < eLo) eLo = p.elevation
      if (p.elevation > eHi) eHi = p.elevation
    }
  }
  // Reach past the cover on both sides so every cut line crosses it cleanly
  // rather than ending on its boundary (a T-junction the 1 mm snap could round
  // onto the wrong side).
  const cutFrom = fLo - 0.05
  const cutTo = fHi + 0.05
  const cuts = new Set<number>()
  for (const band of [...left, ...right, ...kinLeft, ...kinRight]) {
    // Only boundaries that actually cross the silent cover — a cut line outside
    // it adds a segment pair to the overlay and no face.
    if (band.topElev > eLo && band.topElev < eHi) cuts.add(band.topElev)
    if (band.baseElev > eLo && band.baseElev < eHi) cuts.add(band.baseElev)
  }
  const cutRings = [...cuts].map((elevation) => [
    { fraction: cutFrom, elevation },
    { fraction: cutTo, elevation },
  ])

  const covered: SectionRegion[] = []
  const residual: SectionRegion[] = []
  for (const face of overlayFaces([...silent.map((r) => r.polygon), ...cutRings], `lvl-${gapIndex}`)) {
    let home: SectionRegion | null = null
    for (const region of silent) {
      if (pointInRing(face.sample.fraction, face.sample.elevation, region.polygon)) home = region
    }
    if (home === null) continue // outside the silent cover
    // The NEARER test answers first; the far one only when the near one never
    // reached that depth.
    const nearFirst = face.sample.fraction < 0.5
    const own = nearFirst ? [left, right] : [right, left]
    let band = bandAt(own[0], face.sample.elevation) ?? bandAt(own[1], face.sample.elevation)
    let ownFamily = band !== null
    if (band === null) {
      // LAST RESORT. This cover belongs to no chain that carries a density
      // here — a sub-TD substrate face, or a body whose own tests were never
      // divided this deep. The flanking tests may still have read the SAME
      // lithology at this level in a neighbouring body; that class has the
      // right soil and is the nearest measurement there is. Only the gap's own
      // two tests are consulted, never a distant one (the owner's flank rule).
      const kin = nearFirst ? [kinLeft, kinRight] : [kinRight, kinLeft]
      band = bandAt(kin[0], face.sample.elevation) ?? bandAt(kin[1], face.sample.elevation)
      ownFamily = false
    }
    if (band === null) {
      residual.push({
        gapIndex,
        formationId: home.formationId,
        bodyId: home.bodyId,
        kind: 'quad',
        polygon: face.ring,
      })
      continue
    }
    const emitted: SectionRegion = {
      gapIndex,
      formationId: band.formationId,
      bodyId: band.bodyId,
      kind: 'quad',
      polygon: face.ring,
      layerIds: [band.layerId],
    }
    covered.push(emitted)
    if (!ownFamily) crossFamily.push(emitted)
  }
  return { covered, residual, crossFamily }
}
