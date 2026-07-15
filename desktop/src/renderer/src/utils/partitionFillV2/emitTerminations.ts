/**
 * partitionFillV2/emitTerminations.ts — TWO-SIDED / boundary-onlap TERMINATION helpers
 * (ruling 8c, design partition-engine-v2.md §4 "terminate-by-default").
 *
 * Ruling 8c: every unit terminates by its OWN effective corr — 2 → band, 1 → onlap
 * riding its tie, 0 → lens. The seam-based interval tiler (``emitIntervals.tileInterval``)
 * emits thickness-weighted SEAMS between facing units and never per-unit termination
 * curves, so a genuine matched-pair band face merges DOWN through un-terminated 1-corr /
 * 0-corr units into a full-width face. This module carries the shared decisions the
 * per-unit termination emission needs, kept OUT of the already-large ``emitLonePinch.ts``
 * (debt #201 budget).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type LensLabel } from './emitLenses'

/**
 * Choose the enclosing matrix that CLOSES an onlap notch by boundary composition (owner
 * ruling 8a), generalised to the SAME-FORMATION-ENCLOSURE case (ruling 8c).
 *
 * Ruling 8a floods the vacated wedge past an onlap tip with the enclosing matrix on the
 * UNTIED side (a base-tied onlap laps the band below, so the ABOVE matrix descends around
 * the notch; a top-tied onlap the BELOW matrix). That is correct when the untied-side
 * enclosing is a DIFFERENT lithology from the onlapping unit (the S5A|S5 SILT-around-KLEI
 * shape).
 *
 * But when the untied-side enclosing is the unit's OWN formation (the Tie-4 / CS3
 * base-tied-ZAND-below-a-ZAND-band shape — a ZAND unit onlapping the KLEI band below, with
 * the ZAND matched band ABOVE), flooding that same-formation enclosing RE-MERGES the onlap
 * into one full-width ZAND face: the exact ``1corr-not-onlap`` leak the conformance gate
 * flags, and the retired geometric same-formation auto-match (ruling 8). Since the bracket
 * is MIXED (above ≠ below by the caller's guard), the OPPOSITE (tied-band-side) enclosing is
 * guaranteed to differ from the unit — flooding it closes the notch with a real neighbour
 * band, so the onlap reads as a true termination and does not span the gap.
 *
 * Parameters
 * ----------
 * ownFormationId : string
 *     The onlapping unit's own formation.
 * baseTied : boolean
 *     ``true`` when the unit's BASE contact is the tied one (it laps the band below).
 * aboveMatrix, belowMatrix : LensLabel
 *     The bracket enclosing lithologies (above ≠ below — the caller's mixed-bracket guard).
 *
 * Returns
 * -------
 * LensLabel
 *     The enclosing matrix to flood the vacated wedge with: the untied-side enclosing when
 *     it differs from the unit, else the tied-band-side enclosing (which then differs).
 */
export function chooseOnlapEnclosing(
  ownFormationId: string,
  baseTied: boolean,
  aboveMatrix: LensLabel,
  belowMatrix: LensLabel,
): LensLabel {
  const untiedEnclosing = baseTied ? aboveMatrix : belowMatrix
  const tiedSideEnclosing = baseTied ? belowMatrix : aboveMatrix
  return untiedEnclosing.formationId === ownFormationId ? tiedSideEnclosing : untiedEnclosing
}
