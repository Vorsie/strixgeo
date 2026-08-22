/**
 * THE BRIDGE — carrying a band's story across a blind SAME-family column, the
 * geotech constructive arm's other half of the law
 * ``partitionFillV2/emitContinuation.ts`` already carries on the litho side
 * (see ``terminationRun.ts``'s header for the full law).
 *
 * The geotech arm is gap-by-gap (unlike the litho arm's whole-section
 * arrangement — ``fillGap`` runs its own LINES→LOOPS→FILL→MERGE per (family,
 * gap) pair), so the law's consequence is realised differently here — but it
 * needs only ONE new idea, not a parallel set of rules: **splice the band,
 * carrying its own true ``.x``, into every gap between its own column and
 * the true reading column.** ``buildGapConstructs``'s EXISTING
 * ``facingHasData`` check (``constructs.ts``) is evaluated FRESH, per gap,
 * against the SECTION-WIDE ``stacks`` — so it already, correctly, and
 * without any change here, sorts each spliced gap into:
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

import type { RunBand, RunColumn, RunTie } from './constructs'
import { terminationRun } from './terminationRun'

/** Vertical overlap (metres) below which a facing band is a contact touch, not a reading. */
const OVERLAP_EPS = 1e-6
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
   * but never including, the band's own gap (today's ``extendsToFar``
   * already covers that one, unchanged).
   */
  gaps: number[]
}

/**
 * Does any tie land on this exact contact AND cross the gap between
 * ``loCi``/``hiCi`` — matching ``buildGapConstructs``'s own per-gap
 * ``tieOnContact``/``crossesGap`` scoping exactly (owner code-hunt finding,
 * 2026-08-22, the real CS1 S10 bottom MD sand: a band tied RIGHTWARD to a
 * far column was wrongly excluded from continuation LEFTWARD too, because
 * the old check asked "does ANY tie in the run touch this contact" instead
 * of "does a tie touch this contact AND cross the SPECIFIC gap in
 * question" — a tie crossing a completely different gap must never
 * disqualify a direction it never reaches).
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
    return tieLo <= loCi && tieHi >= hiCi
  })
}

/** Does this column's own bands overlap the given window at all? */
function reads(column: RunColumn, top: number, base: number): boolean {
  return column.bands.some((b) => Math.min(b.top, top) - Math.max(b.base, base) > OVERLAP_EPS)
}

/**
 * Work out every band in this run that must be carried across a blind
 * SAME-family column, and where.
 *
 * @param runColumns The family's run, left to right (one run, not the whole section).
 * @param ties The run's surviving packing ties — a direction is untouched
 *   when a tie crosses the band's own immediate gap that way (the 0-tie
 *   lens law alone), scoped per direction, not per band.
 */
export function bandContinuations(
  runColumns: readonly RunColumn[],
  ties: readonly RunTie[],
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
        if (reads(runColumns[immediateIndex], band.top, band.base)) continue
        const run = terminationRun(runColumns, i, dir, band.top, band.base)
        if (!run.reads || run.columnIndex === immediateIndex) continue
        const ciImmediate = runColumns[immediateIndex].ci
        const ciFar = runColumns[run.columnIndex].ci
        // Every gap from the resolved column's own edge up to, but
        // excluding, the band's own gap — buildGapConstructs' unchanged
        // facingHasData sorts each one into a flat pass-through or the one
        // real pinch on its own, per the module header.
        const gaps: number[] = []
        if (dir === -1) {
          for (let g = ciFar; g <= ciImmediate - 1; g++) gaps.push(g)
        } else {
          for (let g = ciImmediate; g <= ciFar - 1; g++) gaps.push(g)
        }
        splices.push({ band, gaps })
      }
    }
  }
  return splices
}
