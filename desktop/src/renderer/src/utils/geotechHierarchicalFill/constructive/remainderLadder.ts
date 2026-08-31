/**
 * *"then fill in the rest with the dominant lithology"* — THE REMAINDER LADDER.
 *
 * Once every construct the law drew (``constructs.ts``) has been asked and none
 * of them claims a loop, the ground still belongs to somebody. This module is
 * the whole of that answer: which bands may be asked, in what widening order,
 * and how one of them wins.
 *
 * TWO RULES SHAPE IT, and both are the owner's:
 *
 *  * *"the remainder of each closed loop goes to the OPEN mass"* (2026-08-21) —
 *    a band that emitted a lens or an onlap has closed its loop and takes no
 *    remainder ground, so the open masses are asked first and the closed ones
 *    only where nothing open can answer (the CF4/CF6 all-closed holes).
 *  * *"yes in this case i'd rather have a vertical line"* (2026-08-24) — when
 *    BOTH facing packages closed at the middle, the leftover splits at the seam
 *    and each half continues the masses of its own test. Nobody floods it, and
 *    least of all a column that does not border the gap.
 *
 * Extracted from ``fillGap.ts`` when the second of those landed (debt #201:
 * that file was over the 500-line mark and the ladder is a self-contained
 * decision — candidates in, one winner out, no geometry of its own beyond the
 * walls it is handed).
 *
 * @module utils/geotechHierarchicalFill/constructive/remainderLadder
 */

import { claims, tieElevAt, type BandConstruct, type RunBand, type RunTie } from './constructs'
import { facingTestHasBottomedOut } from './facingBottomedOut'
import { wallElevAt, wallsFor, type WallScope } from './ownContactTies'

/**
 * Smallest overlap (m) that counts as a band COVERING a loop.
 *
 * Two contacts at the same elevation arrive from different arithmetic — one
 * from ``surfaceElevM - depthM`` on the band, one from a ring vertex the
 * arrangement computed — so a shared boundary overlaps by about 1e-15 m rather
 * than exactly nothing. Measured on his CS2 gap 0: S34's n7 sand, whose base
 * IS the loop's top, "covered" it by 1.6e-15 m and took the whole face below
 * its own base on that strength. Contacts are stored on the mm grid, so a
 * micrometre is far below anything real and far above the noise.
 */
const COVER_EPS = 1e-6

/**
 * How hard a rung tests its winner against the sample's own levels.
 *
 * ``off``    — take whatever the scoring returned (the OPEN circles: an open
 *              mass reaching for ground is the ruled fill-through).
 * ``relate`` — own the level, cover the loop, or lie directly against one of
 *              the band's own contacts (see ``relatesToTheseLevels``).
 * ``own``    — own the level or cover the loop, and nothing else: the
 *              wall-less last rung, where adjacency can no longer be trusted.
 */
type Relevance = 'off' | 'relate' | 'own'

/** Everything one remainder decision needs. */
export interface RemainderInput {
  /** The gap's own two tests' bands — or the nearest carrying ones where no run brackets it. */
  flankBands: readonly RunBand[]
  /** Every band the family has anywhere on this section. */
  familyBands: readonly RunBand[]
  /** Layer ids whose construct CLOSED in this gap — a lens, an onlap, a vertical. */
  closedAtMiddle: ReadonlySet<string>
  /** Along-x of the gap's middle — where a closed statement stops. */
  middle: number
  /** The loop's own elevation extent on the sample's vertical. */
  lo: number
  hi: number
  /** The sample, in along-metres and mTAW. */
  x: number
  y: number
  /** One mass identity for the whole gap (litho + packing class). */
  massKeyOf: (band: RunBand) => string
  /** The correlation lines actually drawn across this gap — the fill's walls. */
  drawnTies: readonly RunTie[]
  /** The ties on each band's OWN contacts, run-wide (see ``ownContactTies.ts``). */
  ownContactTies: ReadonlyMap<string, readonly RunTie[]>
  /** Where each band's closures stand, run-wide (see ``GapFillInput.closureBars``). */
  closureBars: ReadonlyMap<string, readonly number[]>
  /** A band's own onlap construct, by layer — the own-shape guard. */
  shapedByLayer: ReadonlyMap<string, BandConstruct>
  /**
   * EVERY packing band per frame column, whatever family owns it — the same
   * section-wide stacks ``constructs.ts`` reads. Asked one question only: did
   * the facing test measure this ground at all (see ``columnReading.ts``)?
   */
  stacks: ReadonlyMap<number, readonly RunBand[]>
}

/**
 * *"fill in the rest with the dominant lithology"* — of the tests that read
 * this ground, the band that occupies most of the loop's own levels owns it.
 *
 * Where two tests read the same levels and disagree, the overlap alone cannot
 * choose — and that is exactly the case his law draws a VERTICAL LINE IN THE
 * MIDDLE for, so the loop already lies on one side of it and the test on that
 * side owns it. Counted (``split``) so the case stays visible.
 *
 * @param candidates The bands this rung may ask.
 * @param scope Which correlation lines this rung tests against ({@link wallsFor}).
 * @param flankColumns Frame column indices of the gap's own two tests.
 * @param input The decision's context (see {@link RemainderInput}).
 * @returns The winning band (or null) and whether the vertical decided it.
 */
function pickDominant(
  candidates: readonly RunBand[],
  scope: WallScope,
  flankColumns: ReadonlySet<number>,
  input: RemainderInput,
): { band: RunBand | null; split: boolean } {
  const { closedAtMiddle, middle, lo, hi, x, y, massKeyOf, closureBars, shapedByLayer } = input
  const bottomedOut = (band: RunBand, shaped: BandConstruct): boolean =>
    facingTestHasBottomedOut({
      band,
      shaped,
      flankColumns,
      stacks: input.stacks,
      lo,
      hi,
      x,
      y,
    })
  let best: RunBand | null = null
  let bestScore: [number, number, number, number] | null = null
  let split = false
  for (const band of candidates) {
    // A CLOSURE'S STATEMENT ENDS AT ITS PINCH, RUN-WIDE. The per-gap middle
    // rule below only knows the closures THIS gap drew; a band that closed a
    // loop (lens or onlap) in another gap read as open here and its ground
    // walked past its own pinch (S8's D answering the sub-TD window two gaps
    // over). The bar list is absolute: no rung, walls on or off, hands
    // ground across one.
    const bars = closureBars.get(band.layerId)
    if (bars !== undefined && bars.some((barX) => (x - barX) * (band.x - barX) < 0)) continue
    // WHERE A BAND'S OWN CONSTRUCT SPEAKS, IT SPEAKS COMPLETELY (owner,
    // 2026-08-22: *"The loose sand has a bottom tie, not a top tie that is
    // why it is an onlap and should be a triangle and not a quad"*).
    //
    // ci19's ZAND-5 rides its BASE tie and pinches its free top down onto it
    // — the engine drew that triangle correctly. Then the remainder handed
    // the band the wedge directly ABOVE its own pinching top: still inside
    // its nominal 11.06..10.65 window, so it won the ``ownsLevel`` rank, and
    // the two faces together squared off against the mid-gap seam into the
    // quad he circled.
    //
    // THE HATCH THIS LEAVES IS ACCEPTED (owner, 2026-08-23: "hatch is fine,
    // leave it"). On CS1 it moves 13.365 m2 — three faces, all in gap 19, all
    // sand — from a class to the correlate-me hatch, because every construct
    // in that run is closed and no open mass can answer the shadow. Those
    // faces are frozen into the CS1 golden master as the baseline: they are
    // the ruling, not a defect. See docs/design/geotech-stage.md.
    //
    // This is NOT the retired "exclude every shaped band from the remainder"
    // rule (2026-08-21) — that one barred an onlapping mass from ground
    // ELSEWHERE in its cover and painted his spiked comb. A band may still
    // answer anywhere its construct does not reach. What it may never do is
    // re-take ground its OWN shape, at THIS x, has already declared it does
    // not occupy. ``closureBars`` says the same thing along x, past the
    // apex; this says it along y, inside the wedge's own shadow.
    // ONLAP ONLY. A LENS keeps its existing level-scoped treatment (owner
    // 2026-08-21: *"Only a LENS drops out, and only at the levels it closed
    // on"*) — barring it here too left the ground in his gap 19 with NO
    // candidate at all and un-tiled the cover outright (CF6).
    //
    // ...AND ONLY INSIDE THE BAND'S OWN NOMINAL WINDOW (ruled 2026-08-26).
    // The shadow this rule protects is the one described above: ground the
    // band's construct vacated that is STILL within its measured
    // ``base..top``, which is why it won the ``ownsLevel`` rank and squared
    // the wedge back into a quad. Ground wholly OUTSIDE that window was never
    // this rule's business, and barring it there collided head-on with the
    // both-closed ruling of 2026-08-24 — *"yes in this case i'd rather have a
    // vertical line"*, the ground between two closed loops going left half to
    // the left column's masses, right half to the right's (rung 2, plus the
    // middle rule in ``pickDominant``).
    //
    // His CS1 gap 2 is exactly that collision: two bands each spanning the
    // WHOLE litho cover at their own test, both riding one plunging tie, both
    // onlapping. The strip left under the litho top on the right half sits at
    // 6.1..6.7 while the right band is 7.130..7.509 — not one millimetre of
    // overlap — so the guard was refusing the very band the both-closed
    // ruling names, and the cover read "correlate me" down its middle against
    // the owner's own S9/S9b pins. The mirror strip on the left half was
    // already answered this way.
    //
    // Zero overlap is deliberately NOT barred: a loop lying exactly against a
    // contact is the adjacency case ``relatesToTheseLevels`` explicitly
    // allows — *"the wedge that onlap pinches away from is taken by the mass
    // immediately above it"* (his S24). ``COVER_EPS`` keeps a 1e-15 m shared
    // boundary from reading as overlap.
    //
    // ...AND ONLY WHERE SOMEBODY ELSE CAN SPEAK FOR THE GROUND (ruled
    // 2026-08-28). Under the pinching base, below the FACING test's total
    // depth, there is no facing statement at all — see ``facingBottomedOut.ts``
    // for his CS1 gap 14 and the four conditions that scope it.
    const shaped = shapedByLayer.get(band.layerId)
    if (shaped !== undefined && shaped.emit === 'onlap' && shaped.apexX !== undefined) {
      const span = shaped.apexX - shaped.band.x
      const here = x - shaped.band.x
      const withinOwnSpan = span !== 0 && here * span >= 0 && Math.abs(here) < Math.abs(span)
      const insideOwnWindow = Math.min(band.top, hi) - Math.max(band.base, lo) > COVER_EPS
      if (withinOwnSpan && insideOwnWindow && !claims(shaped, x, y) && !bottomedOut(band, shaped)) {
        continue
      }
    }
    // A CLASS MAY NEVER CROSS A CORRELATION (the standing absolute, and the
    // owner's 2026-08-21 spills: the deep VD answering ground ABOVE its own
    // top tie line — over the D|MD correlation, and below S10 whose base is
    // tied both ways). A candidate separated from this ground by any drawn
    // correlation line answers nothing here; level lines are not walls (the
    // sub-TD reach below a band's own untied base stays legal).
    const bandMid = (band.top + band.base) / 2
    const separated = wallsFor(scope, band, input).some((wall) => {
      const atSample = y - wallElevAt(wall, x)
      const atBand = bandMid - wallElevAt(wall, band.x)
      return atSample !== 0 && atBand !== 0 && atSample > 0 !== atBand > 0
    })
    if (separated) continue
    // NO PER-SLIVER "IS THIS BAND'S OWN RANGE CLOSED" CHECK HERE (owner
    // code-hunt finding C2, 2026-08-22, "two agreeing tests must not have
    // their stack inverted mid-gap"): there used to be one, comparing a
    // band's ORIGINAL [base,top] window against the CURRENT LOOP's span —
    // but near a lens's own apex the loop has already narrowed past the
    // band's nominal window, so that check excluded the band from a sliver
    // that was still, geometrically, its own ground, while an UNRELATED
    // band (whose own closed range simply didn't happen to overlap that
    // narrow sliver) slipped through as "open" and won by default — a full
    // stack swap between two identical, uncorrelated logs. The callers
    // (below) already exclude every genuinely-closed band from the OPEN
    // rungs by full-band identity (``closedAtMiddle``, whole-band, not
    // sliver-overlap); once a rung falls through to candidates that MAY be
    // closed, the ordinary scoring (own-level, covers, nearest, thickest)
    // decides — the enclosing-mass case it used to protect resolves the
    // same way via thickness, without a separate exclusion to get wrong.
    // A CLOSED STATEMENT ENDS AT THE MIDDLE. *"if it is different then vertical
    // line in the middle"* — the line is where the two masses stop, so a band
    // that drew a lens, an onlap or a vertical may not be handed remainder
    // ground on the FAR side of it either. Without this the very dense sand's
    // vertical construct stopped at the middle exactly as the law says, and
    // then the fill walked it across anyway and painted the facing test's own
    // half (his S12 scene, ZAND-8 where ZAND-6 stands).
    // ...AND SO DOES A STATEMENT MADE FROM OUTSIDE THE GAP ALTOGETHER (owner,
    // 2026-08-24, on his CS2 gap 0). A band standing beyond the right-hand
    // test is the right-hand test's neighbour, not the left-hand one's: it
    // may continue its mass into the half of the gap on its own side and no
    // further. Without this, every remainder face of a 69 m gap went to
    // GEO-05/040-S1 — 0.4 m past GEO-10/117-B1, its bands the same classes at
    // the same levels — and B1's whole sand package welded left across
    // GEO-23/125-S34's own closed constructs. An OPEN FLANK mass is untouched
    // and still fills through past the middle (the SF silt, ruled
    // 2026-08-21); this is about tests that do not border the gap at all.
    const outsideTheGap = !flankColumns.has(band.ci)
    if (
      (closedAtMiddle.has(band.layerId) || outsideTheGap) &&
      (x - middle) * (band.x - middle) < 0
    ) {
      continue
    }
    const covers = Math.min(band.top, hi) - Math.max(band.base, lo)
    const gapToLevel = covers > 0 ? 0 : Math.max(lo - band.top, band.base - hi)
    // 1. DOES THIS MASS OWN THIS VERY LEVEL — not merely overlap the loop's
    //    span. Ranking on the span let a thick neighbour that reaches into the
    //    loop outrank the band the sample is actually inside, and that painted
    //    over thin logs at their own test (11 own-column samples on his model).
    //    The own-column rule is absolute and outranks thickness.
    // 2. the nearer test, because a test owns the ground beside it;
    // 3. how big the mass is — *"fill in the rest with the dominant lithology"*,
    //    which is what tells his 5.6 m SF silt from a 0.5 m interbed on the
    //    facing test whose own loop has already closed.
    const ownsLevel = y <= band.top && y >= band.base
    const score: [number, number, number, number] = [
      ownsLevel ? 1 : 0,
      covers > 0 ? 1 : -gapToLevel,
      -Math.abs(band.x - x),
      band.top - band.base,
    ]
    let better = bestScore === null
    if (bestScore !== null) {
      for (let k = 0; k < score.length; k++) {
        if (score[k] > bestScore[k] + 1e-9) {
          better = true
          break
        }
        if (score[k] < bestScore[k] - 1e-9) break
      }
    }
    if (
      best !== null &&
      bestScore !== null &&
      score.every((v, k) => Math.abs(v - (bestScore as number[])[k]) <= 1e-9) &&
      massKeyOf(best) !== massKeyOf(band)
    ) {
      split = true
    }
    if (better) {
      best = band
      bestScore = score
    }
  }
  return { band: best, split }
}

/**
 * Ask the ground in widening circles until somebody owns it.
 *
 * @param input The decision's context (see {@link RemainderInput}).
 * @returns The winning band (null where nothing may answer — the hatch) and
 *   whether the vertical had to decide it.
 */
export function pickRemainder(input: RemainderInput): { band: RunBand | null; split: boolean } {
  const { flankBands, familyBands, closedAtMiddle, lo, hi, y } = input
  const open = (bands: readonly RunBand[]): RunBand[] =>
    bands.filter((b) => !closedAtMiddle.has(b.layerId))
  const flankColumns = new Set(flankBands.map((b) => b.ci))
  // A WINNER THAT IS MERELY "CLOSEST, NOTHING ELSE WAS LEFT" IS NO WINNER
  // (owner code-hunt finding B4, 2026-08-22): the scoring above always returns
  // SOMETHING once a rung has candidates — a band that neither owns this level
  // nor overlaps the loop still ranks by ``-gapToLevel``. On every rung that
  // could answer that way the winner must RELATE to the sample's own levels,
  // or the rung declines and the ladder widens. It is what stopped undivided
  // head ABOVE a tie, near the far test, picking up the class that exists only
  // BELOW that same tie.
  const relatesToTheseLevels = (winner: RunBand | null, mode: Relevance): RunBand | null => {
    if (winner === null || mode === 'off') return winner
    const ownsLevel = y <= winner.top && y >= winner.base
    const covers = Math.min(winner.top, hi) - Math.max(winner.base, lo) > COVER_EPS
    if (ownsLevel || covers) return winner
    // ...OR IT IS A FLANK ANSWERING ITS OWN HALF OF A BOTH-CLOSED SEAM (owner,
    // 2026-08-24: *"yes in this case i'd rather have a vertical line"* — the
    // ground between two closed loops goes left half to the left column's
    // masses, right half to the right's).
    //
    // ELEVATION IS THE WRONG TEST INSIDE A DIPPING COVER, and that is the whole
    // reason this escape exists. His CS1 gap 2: one clay cover climbing from
    // 3.67..5.02 on ci2 to 7.13..7.51 on ci3, each test reading a SINGLE class
    // that fills the whole of it, both riding one tie, both onlapping. The
    // leftover under the litho top on the right half sits at 6.10..6.68 — no
    // overlap with the right band's 7.13..7.51, none with the left band's, and
    // no band of the family anywhere on the section reads those levels, because
    // the cover carries them only between the two tests. The level tests above
    // therefore decline every candidate and the cover read "correlate me" down
    // its middle, against his own S9/S9b pins. The seam, not the elevation, is
    // what the 2026-08-24 ruling divides on.
    //
    // FOUR CONDITIONS, and each one is load-bearing. The winner must be a
    // FLANK of this gap (a column that does not border it is the CS2 gap-0
    // flood, barred in ``pickDominant``); it must have CLOSED here (an open
    // mass reaching for ground is rung 1's ruled fill-through and never needs
    // this); the ground must lie on ITS OWN SIDE of the middle, so nothing
    // crosses the seam; and BOTH PACKAGES MUST ACTUALLY BE CLOSED, which is the
    // ruling's own opening words — *"when BOTH facing packages closed at the
    // middle"*.
    //
    // That last one is not decoration; without it this escape re-opens the
    // shape the owner has reported five times. Measured on his Tie-section 12
    // gap 0: that run is an onlapping KLEI|22 facing an OPEN KLEI|21, so it was
    // never a both-closed seam at all — and handing KLEI|22 a leftover at
    // 10.96..11.15, far below its own 13.06..12.69, welded its wedge back into
    // a quad with a 0.19 m riser at f = 0.500. ``onlapClosure``'s sweep caught
    // it. Where an open mass exists on either flank the ground is ITS
    // fill-through to take (rung 1, the SF-silt ruling), not the seam's to
    // divide.
    //
    // ``open(flankBands)`` being empty is exactly that precondition, and it is
    // the same set rung 1 was offered: this escape can only fire where rung 1
    // had nothing to offer in the first place.
    const bothPackagesClosed = open(flankBands).length === 0
    if (
      bothPackagesClosed &&
      flankColumns.has(winner.ci) &&
      closedAtMiddle.has(winner.layerId) &&
      (input.x - input.middle) * (winner.x - input.middle) >= 0
    ) {
      return winner
    }
    // ...OR THE LOOP LIES DIRECTLY AGAINST ONE OF ITS OWN CONTACTS, with
    // nothing of the band's own in between: *"the loose sand has a bottom tie,
    // not a top tie, that is why it is an onlap and should be a triangle"*
    // (owner, 2026-08-22) — and the wedge that onlap pinches away from is
    // taken by the mass immediately above it, closing over the loose sand as
    // it pinches out (his S24, gap 19). Adjacency is what tells that from a
    // band reaching for a shadow four metres and two contacts away.
    //
    // ONLY WHILE THE WALLS STILL STAND. "Nothing of mine in between" is a
    // claim about what lies between the band and the loop, and once the last
    // rung drops the correlation lines there is no longer anything to check
    // it against: B's dense sand, whose top contact IS the drawn tie, sits
    // exactly against the undivided head above that tie and would take it —
    // *"the class that exists only BELOW that same tie"* (owner code-hunt
    // finding B4, 2026-08-22). The wall-less rung keeps the strict test.
    if (mode === 'own') return null
    const adjacent =
      Math.abs(winner.base - hi) <= COVER_EPS || Math.abs(winner.top - lo) <= COVER_EPS
    return adjacent ? winner : null
  }
  // THE CIRCLES. The two flanks first, then the whole family; open masses
  // first, then closed ones — and the WALLS hold in every circle. Only the
  // last one drops them, because a wall chooses BETWEEN candidates and may
  // never un-class ground (measured: 345 cells of KLEI-23 went to hatch
  // without that last resort).
  //
  // WHAT THE LAST RUNG MAY NOT DROP IS THE CANDIDATE'S OWN BOUNDARY (owner,
  // 2026-08-28: *"i don't want the VD sand to spill below that bottom tie"*).
  // Dropping the walls made every correlation vanish, including the one he drew
  // ON the candidate's own contact, and his S9 very dense sand took the wedge
  // 33.7 m away and 0.6 m below its own tied base. The scope names WHICH lines
  // a rung tests against and ``wallsFor`` composes the set per candidate, so no
  // rung can ask for none at all.
  //
  // RUNG 2 IS BOTH PACKAGES CLOSED AT THE MIDDLE (owner, 2026-08-24, on his
  // CS2 gap 0 — GEO-23/125-S34 to GEO-10/117-B1): asked what owns the ground
  // left between two closed loops when neither side runs through — left half
  // to the left column's masses, right half to the right's? — *"yes in this
  // case i'd rather have a vertical line"*. The v2 direct engine answers it in
  // ``partitionFillV2/bothSidesClosed.ts``; this rung is the same ruling here,
  // and the middle rule inside ``pickDominant`` is what draws the line. The
  // flanks used to be asked only BELOW the family circle, so a column that
  // does not border the gap answered first and no seam was ever reached.
  //
  // NO CIRCLE ANSWERS BY ELIMINATION ANY MORE. Every rung that would otherwise
  // hand the ground to "the nearest thing left" now requires its winner to
  // relate to the sample's own levels. The two ungated ones used to sit under
  // the family circle where they rarely fired; once rung 2 and the outside-the
  // -gap middle rule stop the flood above them, they fire for every shadow a
  // closed package leaves — and S34's n7 sand, a 0.6 m lens at -0.92, climbed
  // four metres through its own test's silt window into the shadow under the
  // n6 onlap's pinch on exactly that basis.
  //
  // Rung 1 is untouched and still comes first, so the SF-silt fill-through is
  // exactly as ruled: an open flank mass answers before anything closed is
  // consulted, and it fills through past the middle.
  const rungs: [readonly RunBand[], WallScope, Relevance][] = [
    [open(flankBands), 'drawn', 'off'],
    [flankBands, 'drawn', 'relate'],
    [open(familyBands), 'drawn', 'off'],
    [familyBands, 'drawn', 'relate'],
    [familyBands, 'own-contacts', 'own'],
  ]
  let dominant: { band: RunBand | null; split: boolean } | null = null
  for (const [candidates, scope, relevance] of rungs) {
    if (candidates.length === 0) continue
    dominant = pickDominant(candidates, scope, flankColumns, input)
    dominant = { ...dominant, band: relatesToTheseLevels(dominant.band, relevance) }
    if (dominant.band !== null) break
  }
  return dominant ?? { band: null, split: false }
}
