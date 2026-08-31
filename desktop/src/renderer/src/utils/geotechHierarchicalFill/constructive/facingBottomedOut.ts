/**
 * WHERE THE FACING TEST HAS BOTTOMED OUT — the near test holds its own ground.
 *
 * Owner, 2026-08-28, on Cross-section 1 gap 14, shown a very dense sand painted
 * into the wedge under his dense sand's pinching base:
 *
 *   *"why isn't the closest test on section used? it even has a top and bottom
 *    tie that unit to the left, so that should be a vertical termination in the
 *    middle"*
 *
 * The scene: GEO-23/125-S8 reads dense sand -3.68..-4.45 and silt below.
 * GEO-10/170-S10, facing it 5.3 m away, STOPS at -3.24 — its total depth. He
 * tied S10's base to S8's dense-sand top, so the dense sand has one tie, the law
 * makes it an onlap and it pinches at the middle. The wedge left under that
 * pinching base is ground no test but S8 has ever measured.
 *
 * The remainder ladder's own-shadow guard bars a band from ground its own
 * construct has already vacated (``remainderLadder.ts``, ruled 2026-08-22 on his
 * ci19 loose sand: re-taking it squared the triangle back into the quad he
 * circled). That guard's premise is that the FACING test's statement owns the
 * ground instead. Below the facing test's total depth there is no facing
 * statement to own it, and the only reading of that ground is the near test's.
 *
 * So the guard yields there, and ONLY there. This module is that one question,
 * kept out of the ladder so the ladder stays a decision about candidates and
 * this stays a fact about the two tests.
 *
 * THE SHAPE THE OWNER GETS. The band holds its own levels across and stops at
 * the middle — the ladder's own middle rule terminates every closed statement
 * there, so the vertical he asked for is not drawn by this rule but merely
 * uncovered by it.
 *
 * @module utils/geotechHierarchicalFill/constructive/facingBottomedOut
 */

import { readsWindow } from './columnReading'
import type { BandConstruct, RunBand } from './constructs'

/**
 * Tolerance (m) for standing ON the construct's own base rather than under it.
 *
 * The base arrives from the construct's free-contact interpolation and the
 * sample from a ring vertex the arrangement computed, so ground lying exactly
 * against the pinching line differs by float noise. Contacts are stored on the
 * mm grid, so a micrometre is far below anything real.
 */
const ON_THE_LINE_EPS = 1e-6

/** The one question, and everything needed to answer it. */
export interface FacingBottomedOutInput {
  /** The candidate being tested — its column is the NEAR test. */
  band: RunBand
  /** That band's own onlap construct in this gap. */
  shaped: BandConstruct
  /** Frame column indices of the gap's own two tests. */
  flankColumns: ReadonlySet<number>
  /** EVERY packing band per frame column, whatever family owns it. */
  stacks: ReadonlyMap<number, readonly RunBand[]>
  /** The loop's own elevation extent on the sample's vertical. */
  lo: number
  hi: number
  /** The sample, in along-metres and mTAW. */
  x: number
  y: number
}

/**
 * Is this ground below the facing test's total depth, under the band's own
 * free base?
 *
 * FOUR CONDITIONS, and every one is load-bearing:
 *
 *  * the base must be FREE. Under a TIED base the ground is across a
 *    correlation, and nothing relaxes that — the walls and the band's own
 *    contact ties both refuse it, and they are right to.
 *  * the band must stand on a FLANK of this gap. His words are *"the closest
 *    test on section"*; a column that does not border the gap has a nearer
 *    test between it and this ground and answers nothing here.
 *  * the facing column must EXIST and have measured something. Without this,
 *    a gap with only one flank — his ci19 scene — would read as "the facing
 *    test said nothing" and the guard would yield on the very case it was
 *    written for. "It has no reading here" must be a fact about that test's
 *    total depth, not about there being no test.
 *  * and it must have no reading at THESE levels, asked with the one predicate
 *    every other caller uses (``columnReading.ts``), so this answer can never
 *    drift from what the constructs decided about the same column.
 *
 * @param input The near band, its construct, and the two tests (see
 *   {@link FacingBottomedOutInput}).
 * @returns ``true`` where the near test is the only reading of this ground.
 */
export function facingTestHasBottomedOut(input: FacingBottomedOutInput): boolean {
  const { band, shaped, flankColumns, stacks, lo, hi, x, y } = input
  if (shaped.baseTied) return false
  if (!flankColumns.has(band.ci)) return false
  const others = [...flankColumns].filter((ci) => ci !== band.ci)
  if (others.length !== 1) return false
  const facingStack = stacks.get(others[0])
  if (facingStack === undefined || facingStack.length === 0) return false
  if (readsWindow(facingStack, lo, hi)) return false
  return y <= shaped.baseAt(x) + ON_THE_LINE_EPS
}
