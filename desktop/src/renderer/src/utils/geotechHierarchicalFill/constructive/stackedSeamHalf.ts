/**
 * A STACKED SEAM HALF — *"or better even keep mtaw lvl"*.
 *
 * The seam of 2026-08-24 decided WHERE the leftover between two closed packages
 * splits (*"yes in this case i'd rather have a vertical line"*, see
 * ``remainderLadder.ts``). This module decides what each half then LOOKS LIKE,
 * and it is the owner's 2026-08-25 ruling in two messages:
 *
 *   *"why don't we keep thickness horizontally, and then where gaps emerge e.g.
 *    the silt lense we fill with the least decent adjacent (above or below)
 *    packing?"* — corrected in the same breath: *"or better even keep mtaw
 *    lvl"*.
 *
 *   *"this is only the rule for vertical seems with a stacked sequence on both
 *    side, if it is one on one the rule stays the same. least dense yeah, The
 *    different height is acceptable, i will prolly tie the dense sand on one
 *    column to the dense sand on the second column anyway after this fix, but
 *    we need a decent fallback"*.
 *
 * So the rule is three things and no more:
 *
 *  * **SCOPE** — both facing packages CLOSED (nothing runs through) and both
 *    STACKED (two bands or more each). One mass facing one mass keeps whatever
 *    the collision rule already draws; so does a stack facing a single band.
 *  * **GEOMETRY** — inside such a half, a band runs from its own test to the
 *    seam at CONSTANT mTAW. Not a wedge, not a rescale: the elevations measured
 *    at the test, held flat. The step where the two stacks meet at the seam is
 *    *"acceptable"*.
 *  * **HOLES** — ground in the half that the test's own stack has no band for
 *    (a facing lens pinched away, or the cover envelope reaching past the
 *    shallowest/deepest band) goes to the LEAST DENSE of the bands directly
 *    above and below it. The weaker class is the honest floor.
 *
 * THIS IS A FALLBACK, not a correlation. It is what un-correlated stacked
 * packages get until the engineer ties band to band across the gap — *"i will
 * prolly tie the dense sand on one column to the dense sand on the second
 * column anyway after this fix"*. A band with two tied contacts emits
 * ``nothing``, which makes its package OPEN, which takes the whole gap out of
 * this rule's scope: tied full-width bands are never touched by it.
 *
 * WHY NO CORRELATION-CROSSING GUARD IS NEEDED HERE. The standing absolute is
 * that a class may never cross a drawn tie, and the remainder ladder tests
 * every candidate against the walls for exactly that reason. A flat
 * continuation cannot violate it: a stack is contiguous within a litho unit, so
 * wherever a tie leaves a band's own flat contact the ground on the other side
 * of the tie is already the neighbouring band's own window — there is no hole
 * to fill and nothing to reach across. The only holes that exist are where the
 * stack itself is interrupted, and their two neighbours are the bands the
 * interruption stands between.
 *
 * @module utils/geotechHierarchicalFill/constructive/stackedSeamHalf
 */

import type { BandConstruct, RunBand, RunColumn } from './constructs'

/**
 * Elevation tolerance (m) at which a sample stands ON a contact rather than
 * past it. Contacts are stored on the mm grid and a band's top and base arrive
 * as ``surfaceElevM - depthM``, so a sample sitting exactly on a shared contact
 * misses both windows by floating-point noise without this.
 */
const LEVEL_EPS = 1e-9

/** The smallest number of bands the owner calls *"a stacked sequence"*. */
export const STACKED_MIN_BANDS = 2

/** The two stacks a seam stands between, shallowest band first on each side. */
export interface StackedSeam {
  /** The left test's own bands of this family. */
  left: readonly RunBand[]
  /** The right test's own bands of this family. */
  right: readonly RunBand[]
}

/**
 * Is this gap the case the ruling scopes itself to?
 *
 * @param constructs Every band construct the law drew for this (family, gap).
 * @param run The gap's own two banded tests.
 * @returns The two stacks when BOTH are closed and BOTH are stacked; null
 *   otherwise — one-on-one, stack-versus-single, and any package with a band
 *   that runs through all keep the behaviour they already had.
 */
export function stackedSeamOf(
  constructs: readonly BandConstruct[],
  run: { left: RunColumn; right: RunColumn },
): StackedSeam | null {
  // A band that emits ``nothing`` is OPEN — it spans the gap and fills through
  // (the SF silt, ruled 2026-08-21). One of those on either side and the two
  // packages are not both closed, so the ruling does not reach this gap.
  const closedStack = (column: RunColumn): boolean => {
    if (column.bands.length < STACKED_MIN_BANDS) return false
    return column.bands.every((band) => {
      const construct = constructs.find((c) => c.band.layerId === band.layerId)
      return construct !== undefined && construct.emit !== 'nothing'
    })
  }
  if (!closedStack(run.left) || !closedStack(run.right)) return null
  return { left: run.left.bands, right: run.right.bands }
}

/**
 * The NAD packing class a mass key names, for the density comparison.
 *
 * The fill compares masses by ``SOIL|CLASS`` (see ``packingClassOf``), and
 * within one soil family the NAD table numbers its classes from loosest to
 * densest — SAND 5 loose, 6 medium dense, 7 dense, 8 very dense — so the class
 * number IS the density order the engine already reads everywhere else (the
 * colour ramp walks the same order, loosest lightest). A band whose class is
 * unknown keeps its row id as its packing key and answers null.
 *
 * KNOWN LIMIT: each soil family repeats its density run once for the admixed
 * variant (silty sand restarts at 9), so this orders two bands of the same
 * variant correctly and reads an admixed class as denser than every clean one.
 * Both bands of a hole come from one litho unit's own subdivision, where a
 * variant change across a single contact is not a case that has been seen; the
 * day it is, this is the one function to refine.
 *
 * @param packing The mass's packing key.
 * @returns The NAD class 1..31, or null when the key carries none.
 */
export function nadClassRank(packing: string): number | null {
  const cut = packing.lastIndexOf('|')
  if (cut < 0) return null
  const parsed = Number(packing.slice(cut + 1))
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31 ? parsed : null
}

/**
 * Who owns a sample inside a stacked seam half.
 *
 * @param bands The half's own test's bands, shallowest first.
 * @param y The sample's elevation (mTAW).
 * @param densityRankOf A band's NAD class, or null where it carries none.
 * @returns The band whose own window holds the sample; where none does, the
 *   least dense of the bands directly above and below it (*"least dense
 *   yeah"*); the only one of the two that exists where the hole is at the top
 *   or the bottom of the stack; null only where the stack is empty.
 */
export function seamHalfBand(
  bands: readonly RunBand[],
  y: number,
  densityRankOf: (band: RunBand) => number | null,
): RunBand | null {
  // *"keep mtaw lvl"* — the band whose OWN elevations hold this sample, read
  // flat. Strict interior first so a sample exactly on a shared contact cannot
  // be decided by band order; on the contact itself the shallower band wins,
  // which is the order the stack arrives in.
  for (const band of bands) if (y < band.top && y > band.base) return band
  for (const band of bands) {
    if (y <= band.top + LEVEL_EPS && y >= band.base - LEVEL_EPS) return band
  }
  // A HOLE. Its two neighbours are the nearest band that ends above it and the
  // nearest that starts below it.
  let above: RunBand | null = null
  let below: RunBand | null = null
  for (const band of bands) {
    if (band.base >= y && (above === null || band.base < above.base)) above = band
    if (band.top <= y && (below === null || band.top > below.top)) below = band
  }
  if (above === null) return below
  if (below === null) return above
  const rankAbove = densityRankOf(above)
  const rankBelow = densityRankOf(below)
  // With no class to compare, the mass above closes over the pinching ground —
  // the behaviour the ladder already rules for a wedge an onlap pinches away
  // from (owner, 2026-08-22, on his S24).
  if (rankAbove === null || rankBelow === null) return above
  return rankBelow < rankAbove ? below : above
}
