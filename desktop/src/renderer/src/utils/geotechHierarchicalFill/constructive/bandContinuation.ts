/**
 * THE BRIDGE — carrying a band's story across a column that read NOTHING at its
 * levels, the geotech constructive arm's other half of the law
 * ``partitionFillV2/emitContinuation.ts`` already carries on the litho side
 * (see ``terminationRun.ts``'s header for the full law).
 *
 * The geotech arm is gap-by-gap (unlike the litho arm's whole-section
 * arrangement — ``fillGap`` runs its own LINES→LOOPS→FILL→MERGE per (family,
 * gap) pair), so the law's consequence is realised differently here — but it
 * needs only ONE new idea, not a parallel set of rules: **splice the band,
 * carrying its own true ``.x``, into every gap between its own column and
 * the true reading column.** ``buildGapConstructs``'s ``facingHasData`` check
 * (``constructs.ts``) is evaluated FRESH, per gap, against the SECTION-WIDE
 * ``stacks`` — so it sorts each spliced gap into:
 *
 *  * a flat, full-thickness ``extendsToFar`` pass-through, for every gap
 *    whose own immediate flank is STILL blind to the band (``extendsToFar``
 *    claims unconditionally across its whole gap width — see ``claims()`` in
 *    ``constructs.ts``, which skips the middle-cut entirely for it — so the
 *    mismatch between the spliced band's true ``.x`` and this gap's own
 *    bounds never matters);
 *  * the ordinary, correctly-scaled ``lensReach`` pinch, for the ONE gap
 *    whose flank genuinely reads the ground — the same formula
 *    (``band.x + reach * (xFar - band.x)``) that already runs for an
 *    adjacent 0-tie lens, now simply given a real, once-distant ``xFar`` to
 *    reach for.
 *
 * WHAT COUNTS AS BLIND is the SECTION-WIDE stack, asked through the very
 * predicate ``facingHasData`` uses (``columnReading.ts``, owner ruling
 * 2026-08-25: *"If there is a column then it goed 0.45 to column B and doesn't
 * paint right of that column"*). While this module asked a family-scoped
 * question and ``facingHasData`` asked a section-wide one, a column carrying
 * another family's soil at the band's own levels answered BOTH ways: the band
 * closed against it in its own gap AND was spliced past it to close a second
 * time in the next — the ghost wedge. One predicate makes that unrepresentable.
 *
 * This module decides WHERE the band must be visible; it never decides HOW
 * it is drawn there — that stays entirely ``constructs.ts``'s law, untouched.
 *
 * A DIRECTION is untouched when a tie crosses the band's own immediate gap
 * THAT WAY (its far-end read already comes from an explicit correlation —
 * this mechanism is the 0-tie-lens law's alone, mirroring the
 * ``emit === 'lens'`` gate) — scoped exactly like ``buildGapConstructs``'s
 * own per-gap tie resolution, so a tie crossing the OPPOSITE direction's gap
 * never disqualifies this one (a band tied one way and open the other, e.g.
 * the real CS1 S10 bottom MD sand, still needs its open side carried).
 *
 * Pure module — no I/O, no React.
 *
 * @module utils/geotechHierarchicalFill/constructive/bandContinuation
 */

import type { BandCarry } from './carriedTaper'
import { readsWindow } from './columnReading'
import type { RunBand, RunColumn, RunTie } from './constructs'
import { terminationRun } from './terminationRun'

/** Elevation tolerance (m) at which a tie's endpoint IS a given contact. */
const CONTACT_EPS = 1e-6

/** Where one band must be carried once its immediate neighbour is blind. */
export interface ContinuationSplice {
  /** The band being carried across. */
  band: RunBand
  /**
   * Every frame gap index the band must be spliced into (in both directions
   * of ``buildGapConstructs``'s ``left``/``right`` AND the remainder
   * ladder's ``columns``) — from the true reading column's own gap up to,
   * but never including, the band's own gap (which the band already stands in
   * as a flank of its own).
   */
  gaps: number[]
  /**
   * Every frame gap whose DRAWN shape must follow the carry taper instead of
   * running flat — from the band's OWN gap up to, but excluding, the terminal
   * one (owner ruling 2026-08-25, *"one smooth taper"*; see
   * ``carriedTaper.ts``). The terminal gap is left out deliberately: it already
   * draws the pinch, and {@link carry} exists only to reproduce ITS apex
   * everywhere the band is seen earlier.
   *
   * Note this set starts at the band's own gap, which {@link gaps} never
   * contains — the two are different questions. ``gaps`` asks where the band
   * must be VISIBLE at all; this asks where what is drawn must slope.
   */
  taperGaps: number[]
  /** Where the taper closes — see {@link BandCarry}. */
  carry: BandCarry
}

/**
 * Does any tie land on this exact contact AND actually TERMINATE at the
 * immediate neighbour's own column — matching ``buildGapConstructs``'s own
 * per-gap ``tieOnContact``/``crossesGap`` scoping exactly (owner code-hunt
 * finding, 2026-08-22, the real CS1 S10 bottom MD sand: a band tied
 * RIGHTWARD to a far column was wrongly excluded from continuation
 * LEFTWARD too, because the old check asked "does ANY tie in the run touch
 * this contact" instead of "does a tie touch this contact AND cross the
 * SPECIFIC gap in question" — a tie crossing a completely different gap
 * must never disqualify a direction it never reaches).
 *
 * COVERAGE NOTE (audit, 2026-08-23): this refinement is INERT on the CS1
 * scene the golden master freezes — instrumenting ``bandContinuations`` there
 * yields the identical five splices under equality and under containment, and
 * across 1419 contact-touching evaluations the two never disagree. BC8, a
 * synthetic three-column pin, is the only thing guarding it. The real case the
 * paragraph below names came from a live model that has since been
 * re-correlated; treat the named scene as provenance, not as a live pin.
 *
 * A SECOND owner code-hunt finding, same night: EQUALITY, not containment.
 * A tie's span merely CONTAINING the immediate gap (``tieLo<=loCi &&
 * tieHi>=hiCi``) is not enough — a tie whose far end SKIPS PAST the blind
 * immediate neighbour, landing on a THIRD column further out (the real S10
 * bottom MD sand's shared-contact tie, S10 straight to S11, S8 carrying no
 * endpoint of it at all), still leaves the immediate gap with no flank of
 * its own to draw from: that gap's own ``buildGapConstructs`` call never
 * sees this band as a ``left``/``right`` member, so the tie having "passed
 * over" it settles nothing there. Only a tie that actually TERMINATES at
 * the immediate neighbour's own column (its span EXACTLY equalling
 * ``[loCi, hiCi]``) means that gap's ordinary per-gap resolution already
 * has what it needs; anything wider still needs the splice to be seen at
 * all in the gap(s) between.
 */
function tiedAcrossGap(
  ties: readonly RunTie[],
  ci: number,
  elevation: number,
  loCi: number,
  hiCi: number,
): boolean {
  return ties.some((t) => {
    const onThisContact =
      (t.leftCi === ci && Math.abs(t.leftY - elevation) <= CONTACT_EPS) ||
      (t.rightCi === ci && Math.abs(t.rightY - elevation) <= CONTACT_EPS)
    if (!onThisContact) return false
    const tieLo = Math.min(t.leftCi, t.rightCi)
    const tieHi = Math.max(t.leftCi, t.rightCi)
    return tieLo === loCi && tieHi === hiCi
  })
}

/**
 * Work out every band in this run that must be carried across a blind
 * column, and where.
 *
 * @param runColumns The family's run, left to right (one run, not the whole section).
 * @param ties The run's surviving packing ties — a direction is untouched
 *   when a tie crosses the band's own immediate gap that way (the 0-tie
 *   lens law alone), scoped per direction, not per band.
 * @param stacks EVERY packing band per FRAME column index, whatever family owns
 *   it — the SAME question ``constructs.ts``'s ``facingHasData`` asks, so the
 *   two can never disagree about whether a column read this ground (owner
 *   ruling 2026-08-25, see ``columnReading.ts``).
 */
export function bandContinuations(
  runColumns: readonly RunColumn[],
  ties: readonly RunTie[],
  stacks: ReadonlyMap<number, readonly RunBand[]>,
): ContinuationSplice[] {
  const splices: ContinuationSplice[] = []
  for (let i = 0; i < runColumns.length; i++) {
    const column = runColumns[i]
    for (const band of column.bands) {
      for (const dir of [-1, 1] as const) {
        const immediateIndex = i + dir
        if (immediateIndex < 0 || immediateIndex >= runColumns.length) continue
        // A tie disqualifies this DIRECTION only when it actually crosses
        // the band's own immediate gap that way — the same gap
        // buildGapConstructs' own tieOnContact/crossesGap would consult, so
        // a tie crossing a completely different gap (e.g. the opposite
        // direction) can never wrongly block this one.
        const loCi = Math.min(column.ci, runColumns[immediateIndex].ci)
        const hiCi = Math.max(column.ci, runColumns[immediateIndex].ci)
        if (
          tiedAcrossGap(ties, column.ci, band.top, loCi, hiCi) ||
          tiedAcrossGap(ties, column.ci, band.base, loCi, hiCi)
        ) {
          continue
        }
        // DATA THAT DISAGREES IS STILL DATA (owner ruling 2026-08-25): the
        // neighbour blocks the carry when it measured ANYTHING at these levels,
        // not merely when it measured some of THIS family. Asking the family's
        // own bands here while ``facingHasData`` asked the whole column's let
        // one band close twice — once in its own gap against this neighbour,
        // and again in the gap beyond it.
        if (readsWindow(stacks.get(runColumns[immediateIndex].ci), band.top, band.base)) continue
        const run = terminationRun(runColumns, i, dir, band.top, band.base, stacks)
        if (!run.reads || run.columnIndex === immediateIndex) continue
        const ciImmediate = runColumns[immediateIndex].ci
        const ciFar = runColumns[run.columnIndex].ci
        // Every gap from the resolved column's own edge up to, but
        // excluding, the band's own gap — buildGapConstructs' unchanged
        // facingHasData sorts each one into a pass-through or the one
        // real pinch on its own, per the module header.
        //
        // ...and every gap the band's SHAPE has to slope through on the way,
        // which starts one gap earlier: the band's own. That gap's facing
        // column is the blind one, so it takes the pass-through branch too, and
        // before the 2026-08-25 ruling it drew flat — the step the owner saw
        // stood exactly there.
        const gaps: number[] = []
        const taperGaps: number[] = []
        if (dir === -1) {
          for (let g = ciFar; g <= ciImmediate - 1; g++) gaps.push(g)
          for (let g = ciFar + 1; g <= column.ci - 1; g++) taperGaps.push(g)
        } else {
          for (let g = ciImmediate; g <= ciFar - 1; g++) gaps.push(g)
          for (let g = column.ci; g <= ciFar - 2; g++) taperGaps.push(g)
        }
        // The terminal gap's own two run columns — ``lensReach`` is asked of
        // THEIR ties so the carried gaps reproduce the apex that gap already
        // draws, rather than computing a second one from their own.
        const terminalNear = runColumns[run.columnIndex - dir]
        const terminalFar = runColumns[run.columnIndex]
        splices.push({
          band,
          gaps,
          taperGaps,
          carry: {
            farX: terminalFar.x,
            loCi: Math.min(terminalNear.ci, terminalFar.ci),
            hiCi: Math.max(terminalNear.ci, terminalFar.ci),
          },
        })
      }
    }
  }
  return splices
}
