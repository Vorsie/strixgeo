/**
 * THE SEAM DRAPE — *"follow the lens flank up to the flat tongue point"*.
 *
 * ``stackedSeamHalf.ts`` runs each half's bands flat to the seam and lets the
 * two meet in a vertical step, which the owner accepted on 2026-08-24:
 * *"The different height is acceptable"*. On 2026-08-25 he found the case where
 * it is not, on Cross-section 3 gap 6, and ruled it himself:
 *
 *   *"why doesn't the dense sand just follow the lens flank up to the flat
 *    tongue point"* ... *"yes C is the ruling, implement it, looks best in this
 *    particular case, make sure you test so it doesn't affect other cases"*.
 *
 * Option C, his own caption: *"Flat top to the tongue tip, then the boundary
 * follows the silt lens's own flank down to S2. No cliff, no orphan diagonal —
 * the sand drapes the lens."*
 *
 * THE RULE, and it is three geometric facts about the step, nothing more:
 *
 *  * **A STEP has two ends, and they belong to different halves.** Walk the
 *    seam. Where the two halves answer different masses over a stretch of
 *    elevation, that stretch is a step. One end of it is a contact of the LEFT
 *    half's own stack, the other a contact of the RIGHT half's. That asymmetry
 *    is what makes it a step *between* the two, rather than one half's band
 *    pinching out against a mass that runs past it on both sides.
 *  * **A NOTCH is a construct facing the seam.** The family's own litho cover
 *    is cut into at a test's edge wherever a unit lenses back from that test —
 *    the silt on his S2. A vertex of the cover ring whose two neighbours both
 *    stand on the same cover edge IS that construct's apex, and the two edges
 *    meeting there are its flanks.
 *  * **THE JOIN.** Where a notch's apex stands strictly inside a step, beyond
 *    the seam, and one of its flanks lands at or past the step's far end, the
 *    step's vertical is replaced by: the seam at the near end (*"the flat tongue
 *    point"*), the apex, and that flank's own landing. The ground between the
 *    seam and that line is the near half's — which is the same answer the far
 *    half already gives past the landing, so the two weld and no seam is left.
 *
 * WHAT IT DELIBERATELY REFUSES, because *"it doesn't affect other cases"* is
 * half the ruling:
 *
 *  * **a step both of whose ends are ONE half's contacts.** That is a band of
 *    that half pinching out against ground the other half holds continuously —
 *    there is no facing contact to land on, and joining to a notch inside it
 *    would carve a wedge out of a mass that has no boundary there. His own gap 6
 *    carries exactly this at -0.67..-0.07, with an apex sitting in it.
 *  * **a notch whose apex is not strictly inside the step.** An apex level with
 *    a step's own end is not in it, and a construct outside the step is not that
 *    step's business.
 *  * **anything ambiguous.** Two steps, two notches, or two flanks that all
 *    qualify mean the geometry admits more than one reading, and inventing one
 *    is not a fallback — the vertical stands.
 *
 * Pure module — no I/O, no React, no state. It answers where a boundary runs;
 * ``fillGap`` draws it and reads the ownership off it.
 *
 * @module utils/geotechHierarchicalFill/constructive/seamDrape
 */

import type { RunBand } from './constructs'
import { seamHalfBand, type StackedSeam } from './stackedSeamHalf'

/**
 * Elevation tolerance (m) for "strictly inside" and "at or past".
 *
 * Contacts arrive as ``surfaceElevM - depthM`` and are stored on the mm grid,
 * so a millimetre is the finest real distinction; this sits three orders below
 * it, tight enough that an apex level with a step's own end is refused and loose
 * enough that floating-point noise on a shared contact is not a step.
 */
const LEVEL_EPS = 1e-6

/**
 * Smallest elevation span (m) that is a segment rather than a shared contact.
 *
 * Two stacks routinely state the same contact, which puts two breakpoints a ULP
 * apart; sampling the middle of the sliver between them reads noise.
 */
const SEGMENT_MIN_SPAN = 1e-6

/**
 * How close (in fraction) a notch's flank must stand to a cover edge.
 *
 * THE SAME TOLERANCE ``pocketFaces`` anchors on, and for the same measured
 * reason: the litho fill insets its regions by a metric amount, so a cover's own
 * edge lands at 0.9956 in one gap and 0.9996 in another, and the arrangement
 * identifies segments on a 1e-3 grid of the fraction anyway. A notch's flanks
 * are the cover's OWN vertices, so they agree with its edge to far better than
 * this — the tolerance exists so "the edge" means the cover's, not a literal 1.
 */
const COVER_EDGE_EPS = 5e-4

/** Which half of a stacked seam something belongs to. */
export type SeamSide = 'left' | 'right'

/** A point in the gap's own (fraction, elevation) space. */
export interface DrapePoint {
  fraction: number
  elevation: number
}

/** Where the seam's two tests stand, in the cover's own fraction space. */
export interface CoverEdges {
  lo: number
  hi: number
}

/** The elevation span the cover occupies — the seam is only walked inside it. */
export interface ElevationRange {
  lo: number
  hi: number
}

/** Everything the drape is read from. */
export interface SeamDrapeInput {
  /** The two stacks the seam stands between. */
  seam: StackedSeam
  /** Where the seam stands, in the gap's own fraction space. */
  seamFraction: number
  /** The family's own litho cover rings in this gap — where notches live. */
  coverRings: readonly (readonly DrapePoint[])[]
  /** Where the gap's two tests stand (see {@link CoverEdges}). */
  coverEdges: CoverEdges
  /** The cover's own elevation span. */
  elevations: ElevationRange
  /** One mass identity for the whole gap — ``massKey`` of the band's mass. */
  massKeyOf: (band: RunBand) => string
  /** A band's NAD class, for the least-dense rule inside a half. */
  densityRankOf: (band: RunBand) => number | null
}

/** The boundary that replaces one step's vertical. */
export interface SeamDrape {
  /** The tongue tip at the seam, the notch's apex, the flank's own landing. */
  path: readonly [DrapePoint, DrapePoint, DrapePoint]
  /** The half whose band owns the ground between the seam and the drape. */
  nearSide: SeamSide
  /** Where the seam it detours stands. */
  seamFraction: number
}

/** One stretch of seam over which the two halves answer different masses. */
interface SeamStep {
  lo: number
  hi: number
  /** Which half's own answer changes at that end, where exactly one does. */
  loSide: SeamSide | null
  hiSide: SeamSide | null
}

/** One elevation interval between two adjacent contacts, and what each half says there. */
interface Segment {
  lo: number
  hi: number
  left: string | null
  right: string | null
}

/** One construct cut into a cover edge, apex first. */
interface CoverNotch {
  /** The cover edge its two flanks stand on. */
  side: SeamSide
  apex: DrapePoint
  flanks: readonly [DrapePoint, DrapePoint]
}

/**
 * The drape that replaces this seam's vertical, or null where none does.
 *
 * @param input See {@link SeamDrapeInput}.
 * @returns The single unambiguous drape, or null — which is every gap where the
 *   seam has no step, the step has no facing construct, or more than one reading
 *   qualifies. Null means the seam keeps the vertical it already drew.
 */
export function seamDrapeOf(input: SeamDrapeInput): SeamDrape | null {
  const notches = coverNotches(input.coverRings, input.coverEdges)
  if (notches.length === 0) return null
  const steps = seamSteps(input)
  const found: SeamDrape[] = []
  for (const step of steps) {
    for (const notch of notches) {
      const drape = joinAcross(step, notch, input.seamFraction)
      if (drape !== null) found.push(drape)
    }
  }
  // INVENT NOTHING. More than one reading of the same seam is not a tie to
  // break; it is a scene the ruling does not describe, and the accepted step is
  // the honest answer there.
  return found.length === 1 ? found[0] : null
}

/**
 * Does the drape claim this sample for its near half?
 *
 * The pocket is the ground between the seam and the drape, over the drape's own
 * elevation window and no further — outside it the seam is the vertical it
 * always was.
 *
 * @param drape The seam's drape.
 * @param fraction The sample's position across the gap.
 * @param elevation The sample's elevation (mTAW).
 * @returns True where the near half answers instead of the far one.
 */
export function drapeHolds(drape: SeamDrape, fraction: number, elevation: number): boolean {
  const at = drapeFractionAt(drape, elevation)
  if (at === null) return false
  return drape.nearSide === 'left'
    ? fraction > drape.seamFraction && fraction < at
    : fraction < drape.seamFraction && fraction > at
}

/**
 * The drape's own fraction at an elevation, or null outside its window.
 *
 * @param drape The seam's drape.
 * @param elevation The elevation to read it at (mTAW).
 * @returns The fraction the drape stands at, or null.
 */
function drapeFractionAt(drape: SeamDrape, elevation: number): number | null {
  for (let i = 0; i + 1 < drape.path.length; i++) {
    const a = drape.path[i]
    const b = drape.path[i + 1]
    const lo = Math.min(a.elevation, b.elevation)
    const hi = Math.max(a.elevation, b.elevation)
    if (elevation <= lo || elevation >= hi) continue
    const t = (elevation - a.elevation) / (b.elevation - a.elevation)
    return a.fraction + t * (b.fraction - a.fraction)
  }
  return null
}

/**
 * Every stretch of the seam over which the two halves answer different masses.
 *
 * Walked over the contacts of BOTH stacks, because a step ends wherever either
 * half changes its mind — and which of the two it was is exactly what says whose
 * contact that end is.
 *
 * @param input See {@link SeamDrapeInput}.
 * @returns The steps, deepest first, each carrying whose contact each end is.
 */
function seamSteps(input: SeamDrapeInput): SeamStep[] {
  const { seam, elevations, massKeyOf, densityRankOf } = input
  const answer = (side: SeamSide, elevation: number): string | null => {
    const band = seamHalfBand(side === 'left' ? seam.left : seam.right, elevation, densityRankOf)
    return band === null ? null : massKeyOf(band)
  }
  const levels = new Set<number>([elevations.lo, elevations.hi])
  for (const band of [...seam.left, ...seam.right]) {
    for (const level of [band.top, band.base]) {
      if (level > elevations.lo && level < elevations.hi) levels.add(level)
    }
  }
  const sorted = [...levels].sort((a, b) => a - b)
  const segments: Segment[] = []
  for (let i = 0; i + 1 < sorted.length; i++) {
    const lo = sorted[i]
    const hi = sorted[i + 1]
    if (hi - lo <= SEGMENT_MIN_SPAN) continue
    const mid = (lo + hi) / 2
    segments.push({ lo, hi, left: answer('left', mid), right: answer('right', mid) })
  }
  /** Which half changed its answer between two adjacent segments, if one did. */
  const changedAt = (below: number, above: number): SeamSide | null => {
    if (below < 0 || above >= segments.length) return null
    const left = segments[below].left !== segments[above].left
    const right = segments[below].right !== segments[above].right
    if (left && !right) return 'left'
    if (right && !left) return 'right'
    return null
  }
  // A step runs while the SAME two masses face each other. Where the pair
  // changes without ever agreeing, one step ends and the next begins at that
  // very contact — two different disagreements are two different steps, each
  // with its own two ends.
  const steps: SeamStep[] = []
  let start = -1
  for (let i = 0; i <= segments.length; i++) {
    const segment: Segment | null = i < segments.length ? segments[i] : null
    const facing: Segment | null =
      segment !== null &&
      segment.left !== null &&
      segment.right !== null &&
      segment.left !== segment.right
        ? segment
        : null
    if (
      facing !== null &&
      start >= 0 &&
      segments[start].left === facing.left &&
      segments[start].right === facing.right
    ) {
      continue
    }
    if (start >= 0) {
      steps.push({
        lo: segments[start].lo,
        hi: segments[i - 1].hi,
        loSide: changedAt(start - 1, start),
        hiSide: changedAt(i - 1, i),
      })
    }
    start = facing === null ? -1 : i
  }
  return steps
}

/**
 * Every construct cut into a cover edge — a vertex whose two neighbours both
 * stand on the same edge, which is that construct's apex.
 *
 * @param rings The family's own cover rings in this gap.
 * @param edges Where the gap's two tests stand.
 * @returns One entry per notch; empty where the cover has straight edges.
 */
function coverNotches(
  rings: readonly (readonly DrapePoint[])[],
  edges: CoverEdges,
): CoverNotch[] {
  const found: CoverNotch[] = []
  for (const ring of rings) {
    if (ring.length < 3) continue
    for (let i = 0; i < ring.length; i++) {
      const apex = ring[i]
      const before = ring[(i - 1 + ring.length) % ring.length]
      const after = ring[(i + 1) % ring.length]
      for (const [side, edge] of [
        ['right', edges.hi],
        ['left', edges.lo],
      ] as const) {
        const onEdge = (p: DrapePoint): boolean => Math.abs(p.fraction - edge) <= COVER_EDGE_EPS
        if (!onEdge(before) || !onEdge(after) || onEdge(apex)) continue
        found.push({ side, apex, flanks: [before, after] })
      }
    }
  }
  return found
}

/**
 * The join across one step through one notch, where the two describe each other.
 *
 * @param step The stretch of seam whose vertical is a candidate.
 * @param notch The construct facing it.
 * @param seamFraction Where the seam stands.
 * @returns The drape, or null where this pair does not qualify.
 */
function joinAcross(step: SeamStep, notch: CoverNotch, seamFraction: number): SeamDrape | null {
  // THE TIP STANDS AT THE OPPOSITE HALF'S OWN END. A notch is cut into one
  // test's edge, so the construct belongs to that half; the tongue that has to
  // reach it comes from the other one, and the end it starts from is the end
  // that half's own contact makes.
  const nearSide: SeamSide = notch.side === 'right' ? 'left' : 'right'
  const downward = step.hiSide === nearSide && step.loSide === notch.side
  const upward = step.loSide === nearSide && step.hiSide === notch.side
  if (!downward && !upward) return null
  const tipElev = downward ? step.hi : step.lo
  const targetElev = downward ? step.lo : step.hi
  if (notch.apex.elevation <= step.lo + LEVEL_EPS) return null
  if (notch.apex.elevation >= step.hi - LEVEL_EPS) return null
  // ...and BEYOND the seam. An apex on the tongue's own side of the seam is not
  // something the tongue reaches out to; the join would double back.
  const beyond =
    notch.side === 'right'
      ? notch.apex.fraction > seamFraction + LEVEL_EPS
      : notch.apex.fraction < seamFraction - LEVEL_EPS
  if (!beyond) return null
  // THE FLANK THAT LANDS AT OR PAST THE FAR END. The other flank leads back
  // toward the tip's own end and closes nothing. Exactly one may qualify.
  const landings = notch.flanks.filter((flank) =>
    downward
      ? flank.elevation <= targetElev + LEVEL_EPS
      : flank.elevation >= targetElev - LEVEL_EPS,
  )
  if (landings.length !== 1) return null
  return {
    path: [{ fraction: seamFraction, elevation: tipElev }, notch.apex, landings[0]],
    nearSide,
    seamFraction,
  }
}
