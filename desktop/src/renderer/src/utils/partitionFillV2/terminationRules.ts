/**
 * partitionFillV2/terminationRules.ts — the SHARED ruled-exception predicates for the
 * termination sweep (owner rulings 8e / 8g(b), design partition-engine-v2.md §8).
 *
 * THE HOIST emits a termination for EVERY 0-corr and 1-corr unit UNCONDITIONALLY. The ONLY
 * ruled suppressions are the owner's MERGE rulings — a unit that legitimately merges into its
 * own formation's band is its band, and takes no termination:
 *
 *   - 8e (``sameFormationEnclosedByTiedBand``): the unit's formation carries a MATCHED-PAIR
 *     BAND across the gap (``collectGapBands``) — following the lines closes ONE same-formation
 *     face around any minority ("it should be one sand"). Any full-width same-formation extent
 *     of that unit is that one body, not a separate termination.
 *   - 8g(b) (``sameFormationBaseTiedPair``): a purely BASE-TIED unit whose FACING side carries
 *     the SAME formation across the gap connects into ONE band through the shared base tie
 *     ("with or without the extra sand-top tie the sands connect"). Its expected shape is BAND,
 *     not onlap — so the sweep must NOT emit an onlap for it.
 *
 * These are DERIVED FROM THE RULES (``collectGapBands`` + the facing-column stack), NOT from a
 * tiler-local heuristic — the SAME predicates the conformance gate uses. The gate re-exports
 * them (``partitionFillV2.conformance.classify.ts``) so the engine and the gate CANNOT drift:
 * the engine suppresses exactly the terminations the gate accepts as a band render.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type GapBand } from './emitBands'

/**
 * OWNER RULING 8e — SAME-FORMATION ENCLOSURE CONFORMS (one body by construction).
 *
 * A unit whose formation carries a MATCHED-PAIR BAND (a drawn/derived same-side same-formation
 * tie between the two facing units — ``collectGapBands``) across this gap is enclosed by its
 * own formation's legitimately-tied face → ONE body. The unit takes no separate termination.
 *
 * NEGATIVE GUARD (ruling 8): no band of that formation in the gap → ``false`` → the unit
 * terminates (two untied same-formation units are OPPOSING lenses, the retired auto-match).
 *
 * Parameters
 * ----------
 * bands : readonly GapBand[]
 *     The gap's matched-pair bands (``collectGapBands``).
 * formationId : string
 *     The unit's formation.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the unit's formation has a tie-anchored matched-pair band in this gap.
 */
export function sameFormationEnclosedByTiedBand(
  bands: readonly GapBand[],
  formationId: string,
): boolean {
  for (const b of bands) if (b.formationId === formationId) return true
  return false
}

/**
 * OWNER RULING 8g(b) — BASE-TIED SAME-FORMATION PAIRS ARE ONE BAND.
 *
 * A purely BASE-TIED 1-corr unit (top untied) whose FACING column carries a unit of the SAME
 * formation vertically overlapping the audited unit's own elevation band connects into ONE band
 * through the shared base tie. Its expected render is BAND, not onlap — so the sweep suppresses
 * its onlap termination (the enclosing flood + the same-formation facing run band it full-width).
 *
 * This is NOT the ``collectGapBands`` matched pair (symmetric tie → corr 2); it is the
 * ASYMMETRIC case (each same-formation unit rides a DIFFERENT tie, e.g. both base-tie the deep
 * band below) that ``effectiveCorr`` scores corr 1 but the owner ruled a band.
 *
 * Parameters
 * ----------
 * baseTied : boolean
 *     Whether the unit's base contact is effectively tied (direct/derived).
 * topTied : boolean
 *     Whether its top is tied (a both-tied unit is corr 2, not reaching here).
 * formationId : string
 *     The unit's formation.
 * bandLo, bandHi : number
 *     The unit's own elevation band (mTAW).
 * facing : { units : { formationId; topElev; baseElev }[] }
 *     The facing column.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the unit base-ties a same-formation facing run (one band by 8g(b)).
 */
export function sameFormationBaseTiedPair(
  baseTied: boolean,
  topTied: boolean,
  formationId: string,
  bandLo: number,
  bandHi: number,
  facing: { units: { formationId: string; topElev: number; baseElev: number }[] },
): boolean {
  if (!baseTied || topTied) return false
  for (const fu of facing.units) {
    if (fu.formationId !== formationId) continue
    if (Math.min(fu.topElev, bandHi) - Math.max(fu.baseElev, bandLo) > 1e-6) return true
  }
  return false
}
