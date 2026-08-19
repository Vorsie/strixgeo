/**
 * THE FAMILY FLOOD — what a family's own cover reads where its constructs are silent.
 *
 * The 2/1/0 law draws the boundaries: two ties band, one tie onlaps its line, no ties
 * closes as a lens at its own level. Those are the CONSTRUCTS, and the per-family
 * partition run emits them. Everything they leave over is RESIDUAL GROUND — cover the
 * litho model says belongs to this body and no construct claimed. This module resolves
 * all of it, in one pass, with one rule (owner, 2026-08-19):
 *
 *   *"Below TD there is a SF on the test to the right that gets adopted ... there the SF
 *    silt is one band, it gets split below TD at S8? why?"*
 *   *"the silt is bounded by a bottom tie and the sand is bounded by a top tie, which
 *    makes it a closed loop where the clay from the left should fill like in the litho"*
 *   *"we have a closed form, the only thing left that can flood that form is the MF silt
 *    to the left"*
 *
 * ONE CHAIN, asked in the order of what actually read the ground. For every residual face,
 * cut at the answering tests' own band boundaries — a band closes at ITS OWN LEVEL, so the
 * levels that matter are the ones those tests measured — and for each slice:
 *
 *  1. the nearest ANSWERING test with a band at that level. The answering tests are this
 *     gap's own two, the standing flank rule; only where NEITHER of them carries this body
 *     at all does the body's own nearest test elsewhere answer — which is the whole point of
 *     knowing the family's other tests, because a body whose only divided test stands two
 *     gaps away is still the only thing that read it.
 *  2. failing that, the ground is a form the constructs closed around and its only legal
 *     filler is the wall of that form — the nearest band, within the reach ITS OWN 2/1/0
 *     envelope grants it (own extent, unioned with the ties it carries). This is the case
 *     the horizontal read gave up on, and giving up there is giving up exactly where the
 *     flood is for.
 *
 * WHAT IS NEVER INVENTED. The extent is the litho model's and the classes are measured, so
 * the soil is right by construction and no class appears that a real chain does not carry.
 * Ground no rule above can answer stays residual and renders "correlate me" — the truth.
 *
 * @module utils/geotechHierarchicalFill/familyFlood
 */

import { overlayFaces, pointInRing } from './frameClipGeometry'
import type { PartitionColumn, SectionRegion } from '../partitionFill'

/** One band of a family, in absolute elevation. */
export interface FamilyBand {
  formationId: string
  bodyId: string | null
  layerId: string
  topElev: number
  baseElev: number
  /**
   * How far this band may legitimately reach in THIS gap: its own extent, unioned with the far
   * ends of the ties it carries across the gap. A tied band follows its line — that is what a
   * correlation says — and an untied one reaches nowhere but its own level. Same envelope the
   * 2/1/0 conformance gate audits against, so the flood and the gate cannot disagree. Omitted
   * ⇒ the band's own extent.
   */
  reachTopElev?: number
  reachBaseElev?: number
}

/** One banded column of a family, at its along-section position. */
/** Elevation ranges a band's own construct already claims in this gap. */
export type ClosedRanges = ReadonlyMap<string, readonly (readonly [number, number])[]>

export interface FamilySource {
  /** Along-section metres of the test. */
  alongM: number
  /** Its bands of this family, shallowest first. */
  bands: FamilyBand[]
  /** Whether it is one of the two tests THIS gap runs between. */
  flank: boolean
}

/**
 * One column's family bands as elevation intervals.
 *
 * @param column The column, already reduced to one family's bands.
 * @returns The bands, shallowest first.
 */
export function familyBands(column: PartitionColumn | undefined): FamilyBand[] {
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

/**
 * Has this band's OWN construct already closed at this level in this gap?
 *
 * The 2/1/0 constructs are drawn first and the flood fills what they leave. A band that closed as
 * a lens at a level has said where it ends; painting it again past its own loop — because the
 * level read still finds it on its column — undoes that construct. On CS1 gap 5 it carried a
 * 0.37 m interbed out to four fifths of the gap when its lens ends at 0.45, and the class that
 * wraps it above and below never got its level. Where a band's construct does NOT reach the level
 * (below the run's floor, ground the engine claimed nothing in), it has closed nothing there and
 * the ordinary level read stands — which is what keeps a stack adopted under a shallower test's TD.
 */
function hasClosedAt(closed: ClosedRanges, layerId: string, elevation: number): boolean {
  const ranges = closed.get(layerId)
  if (ranges === undefined) return false
  for (const [lo, hi] of ranges) if (elevation >= lo && elevation <= hi) return true
  return false
}

/** The band of ``bands`` whose interval contains ``elevation``, or null. */
function bandAt(bands: readonly FamilyBand[], elevation: number): FamilyBand | null {
  for (const band of bands) {
    if (elevation <= band.topElev && elevation >= band.baseElev) return band
  }
  return null
}

/**
 * The band of ``bands`` nearest ``elevation`` — the wall a closed form floods from — or null
 * when no band's own envelope reaches that far.
 *
 * The envelope is the 2/1/0 law, and it is the same one the conformance gate audits: a band's
 * own extent, unioned with the ties it carries. A one-tie band follows its line, so the form
 * the line closes is its to fill; an untied band closes at its own level and fills nothing
 * beyond it. Ground outside every envelope is ground nothing read — it stays residual and
 * renders "correlate me", which is the truth.
 */
function nearestBand(
  bands: readonly FamilyBand[],
  elevation: number,
  closed: ClosedRanges,
): FamilyBand | null {
  let best: FamilyBand | null = null
  let bestDistance = Infinity
  for (const band of bands) {
    // A band that closed at this level has said where it ends — it is not the wall of this form.
    if (hasClosedAt(closed, band.layerId, elevation)) continue
    const distance =
      elevation > band.topElev
        ? elevation - band.topElev
        : elevation < band.baseElev
          ? band.baseElev - elevation
          : 0
    const reachHi = Math.max(band.topElev, band.reachTopElev ?? band.topElev)
    const reachLo = Math.min(band.baseElev, band.reachBaseElev ?? band.baseElev)
    if (elevation > reachHi || elevation < reachLo) continue
    if (distance < bestDistance) {
      bestDistance = distance
      best = band
    }
  }
  return best
}

/** A face's elevation range and its centroid's along-section position. */
function faceBounds(
  polygon: readonly { fraction: number; elevation: number }[],
  left: number,
  right: number,
): { eLo: number; eHi: number; along: number } {
  let eLo = Infinity
  let eHi = -Infinity
  let fSum = 0
  for (const p of polygon) {
    if (p.elevation < eLo) eLo = p.elevation
    if (p.elevation > eHi) eHi = p.elevation
    fSum += p.fraction
  }
  return { eLo, eHi, along: left + (fSum / polygon.length) * (right - left) }
}

/**
 * The family's tests that READ this face's ground, nearest first.
 *
 * "Read" is the honest word: a test whose own bands reach none of the face's levels never saw
 * that ground, so neither its levels nor its classes belong to it and it contributes neither a
 * cut nor an answer. Ordering is ``readersNearest``' job, per point.
 */
function readersOf(
  sources: readonly FamilySource[],
  bounds: { eLo: number; eHi: number },
): FamilySource[] {
  const out: FamilySource[] = []
  for (const source of sources) {
    if (source.bands.length === 0) continue
    let top = -Infinity
    let base = Infinity
    for (const band of source.bands) {
      if (band.topElev > top) top = band.topElev
      if (band.baseElev < base) base = band.baseElev
    }
    // Touching counts: a form sitting exactly on a band's top is the form that band closed.
    if (Math.min(top, bounds.eHi) - Math.max(base, bounds.eLo) < 0) continue
    out.push(source)
  }
  return out
}

/**
 * The readers ordered for ONE point of ground: THIS GAP'S OWN TWO TESTS FIRST, nearest first,
 * then the rest of the family's tests by distance.
 *
 * The gap's own tests outrank every other one — the owner's standing flank rule (2026-08-11,
 * "we correlate over the boreholes from cpt to cpt ... section is the guideline", and the 623 m
 * donor he rejected). Letting a third test that merely happens to be closer than the far flank
 * answer would take ground away from a test standing right there, and that test's own bands
 * would then appear nowhere in the gap at all. A non-flank test is consulted only where NEITHER
 * of the gap's own tests read the ground — which is the whole point of widening the set: a body
 * whose only divided test stands two gaps away is still the only thing that read it.
 *
 * Per POINT, not per face: a residual face can be wide, and the test that answers its left end
 * is not the one that answers its right end.
 */
function readersNearest(readers: readonly FamilySource[], along: number): FamilySource[] {
  return [...readers].sort((a, b) => {
    if (a.flank !== b.flank) return a.flank ? -1 : 1
    return Math.abs(a.alongM - along) - Math.abs(b.alongM - along)
  })
}

/**
 * Flood every residual face of one family's cover in one gap.
 *
 * @param silent The cover the family's constructs did not claim.
 * @param sources Every banded column of the family, with its along position.
 * @param left, right The gap's along-section bounds (the fraction axis of ``silent``).
 * @param gapIndex The frame gap index stamped on every emitted region.
 * @param closed What each band's own construct already claims here (see ``hasClosedAt``).
 * @returns Classed faces and whatever nothing could answer.
 */
export function floodFamilyCover(
  silent: readonly SectionRegion[],
  sources: readonly FamilySource[],
  left: number,
  right: number,
  gapIndex: number,
  closed: ClosedRanges = new Map(),
): { covered: SectionRegion[]; residual: SectionRegion[] } {
  const covered: SectionRegion[] = []
  const residual: SectionRegion[] = []
  if (silent.length === 0) return { covered, residual }
  const hasSource = sources.some((s) => s.bands.length > 0)
  // A FAMILY WITH NO BANDS ANYWHERE STAYS HATCH. Its cover may be filled by its own chain's
  // bands or by nothing — never by a band of another unit, however alike the soil looks. That
  // reach used to answer here, and on CS1 gap 5 it painted one test's silt class inside a
  // different test's silt unit that no correlation joins to it.
  if (!hasSource) return { covered: [], residual: [...silent] }

  for (const home of silent) {
    const bounds = faceBounds(home.polygon, left, right)
    const allReaders = hasSource ? readersOf(sources, bounds) : []
    // THE GAP'S OWN TWO TESTS ANSWER IT — the owner's standing flank rule (2026-08-11, "we
    // correlate over the boreholes from cpt to cpt ... section is the guideline"; the 623 m donor
    // he rejected). Only where NEITHER of them carries this body at all does the body's own
    // nearest test elsewhere answer, which is the whole point of knowing the family's other
    // tests: a body whose only divided test stands two gaps away is still the only thing that
    // read it. Letting every test of the family speak everywhere slices the cover at levels
    // measured hundreds of metres away — the section-wide horizontal strips.
    const flankReaders = allReaders.filter((r) => r.flank)
    const readers = (flankReaders.length > 0 ? flankReaders : allReaders)
      .slice()
      .sort((a, b) => a.alongM - b.alongM)
    // Cut at the ANSWERING tests' own boundaries: a band closes at ITS OWN LEVEL, so the levels
    // that matter are the ones those tests measured. With no reader at all the same-lithology
    // last resort answers, and it reads this gap's own two tests exactly as before.
    const cutElevs = new Set<number>()
    for (const band of readers.flatMap((r) => r.bands)) {
      if (band.topElev > bounds.eLo && band.topElev < bounds.eHi) cutElevs.add(band.topElev)
      if (band.baseElev > bounds.eLo && band.baseElev < bounds.eHi) cutElevs.add(band.baseElev)
    }
    // Reach past the cover on both sides so every cut line crosses it cleanly rather than
    // ending on its boundary (a T-junction the 1 mm snap could round onto the wrong side).
    let fLo = Infinity
    let fHi = -Infinity
    for (const p of home.polygon) {
      if (p.fraction < fLo) fLo = p.fraction
      if (p.fraction > fHi) fHi = p.fraction
    }
    const cutRings: { fraction: number; elevation: number }[][] = [...cutElevs].map((elevation) => [
      { fraction: fLo - 0.05, elevation },
      { fraction: fHi + 0.05, elevation },
    ])
    // WHERE THE ANSWER CHANGES, SO DOES THE FACE. Each test answers the ground NEARER to it —
    // that is the whole of rule 1's tie-break and rule 3's choice of wall. Sampling a face once
    // and painting all of it from that sample hands ground beside one test to the other one;
    // cutting at the halfway line resolves the same rule geometrically instead. On a cover the
    // litho tie connects but no geotech tie bands, this is exactly the meeting the owner asks
    // for — "left is MD right is D" — and where both sides answer alike the two pieces carry
    // the same class and read as one.
    const midpoints = new Set<number>()
    for (let i = 0; i + 1 < readers.length; i++) {
      const a = (readers[i].alongM - left) / (right - left)
      const b = (readers[i + 1].alongM - left) / (right - left)
      const mid = (a + b) / 2
      if (mid > fLo + 1e-6 && mid < fHi - 1e-6) midpoints.add(mid)
    }
    for (const fraction of midpoints) {
      cutRings.push([
        { fraction, elevation: bounds.eLo - 0.05 },
        { fraction, elevation: bounds.eHi + 0.05 },
      ])
    }
    for (const face of overlayFaces([home.polygon, ...cutRings], `flood-${gapIndex}`)) {
      if (!pointInRing(face.sample.fraction, face.sample.elevation, home.polygon)) continue
      // THE ONE CHAIN, in the order of what actually read this ground.
      let band: FamilyBand | null = null
      const near = readersNearest(readers, left + face.sample.fraction * (right - left))
      // 1. The nearest answering test with a band AT this level — an untied band closes at its
      //    own level, so the level decides and proximity only breaks the tie.
      for (const reader of near) {
        band = bandAt(reader.bands, face.sample.elevation)
        // A band that has already CLOSED at this level does not answer again past its own loop.
        if (band !== null && hasClosedAt(closed, band.layerId, face.sample.elevation)) band = null
        if (band !== null) break
      }
      // 2. Nothing read this level at all: the ground is a form the constructs closed around, and
      //    its only legal filler is the wall of that form — the nearest band, within the reach
      //    that band's own size grants it.
      if (band === null) {
        for (const reader of near) {
          band = nearestBand(reader.bands, face.sample.elevation, closed)
          if (band !== null) break
        }
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
    }
  }
  return { covered, residual }
}
