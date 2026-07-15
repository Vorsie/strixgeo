/**
 * partitionFillV2.conformance.classify.ts — pure classifier helpers for the full 2/1/0
 * conformance gate (``partitionFillV2.conformance.diag.test.ts``). Design:
 * docs/design/partition-engine-v2.md §8 rulings 8 / 8a / 8b.
 *
 * Extracted from the diag to keep that file under the 500-line budget (debt #201),
 * mirroring the ``partitionFillV2.shapeaudit.zerocorr.ts`` extraction. Two concerns live
 * here:
 *   1. RENDERED-SHAPE classification of a SectionRegion set (band / onlap / lens / absent).
 *   2. EFFECTIVE TIE derivation mirroring the engine (``tiedContacts`` direct + derived
 *      base-tie, the ruling-8a shared-contact derived onlap, and matched-pair band
 *      membership via ``collectGapBands``).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type PartitionPoint, type SectionRegion } from './partitionFill'
import { type GapBand } from './partitionFillV2/emitBands'

// Corr-arithmetic (tiedFlags / derivedBandTies / isBandMember / topBandTies /
// unitHasDirectTie / effectiveCorrForUnit) now lives in the ENGINE package as the SINGLE
// source of truth (``partitionFillV2/effectiveCorr.ts``, ruling 8c). Re-export it here so
// the gate keeps its import surface AND cannot drift from the engine — the engine emits the
// termination the arithmetic names; the gate checks the render against the SAME arithmetic.
export {
  derivedBandTies,
  effectiveCorrForUnit,
  isBandMember,
  tiedFlags,
  topBandTies,
  unitHasDirectTie,
  type EffectiveCorr,
} from './partitionFillV2/effectiveCorr'

/** Within this fraction of a column edge counts as "reaches" it. */
export const FULL_EPS = 0.02

/** Rendered termination shape of a formation over a unit's elevation band in a gap. */
export type RenderShape = 'absent' | 'band' | 'onlap' | 'lens'

/** Fraction extent [min,max] of a polygon ring. */
function fracExtent(poly: readonly PartitionPoint[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const p of poly) {
    if (p.fraction < lo) lo = p.fraction
    if (p.fraction > hi) hi = p.fraction
  }
  return [lo, hi]
}

/** Elevation overlap [lo,hi] of a polygon with a target band (0-length if none). */
function elevOverlap(poly: readonly PartitionPoint[], bandLo: number, bandHi: number): [number, number] {
  let plo = Infinity
  let phi = -Infinity
  for (const p of poly) {
    if (p.elevation < plo) plo = p.elevation
    if (p.elevation > phi) phi = p.elevation
  }
  return [Math.max(plo, bandLo), Math.min(phi, bandHi)]
}

/**
 * The rendered shape of a formation over a target elevation band in a gap: scan every region
 * of that formation, keep the pieces whose elevation overlaps the band, and report the widest
 * reach from each column edge. Classes: ``absent``, ``band`` (spans ~0..1), ``onlap`` (reaches
 * exactly one edge, tapers off the other), ``lens`` (reaches neither edge — a free-floating /
 * both-tapering closed shape).
 *
 * Parameters
 * ----------
 * regs : readonly SectionRegion[]
 *     The gap's regions (v2 output).
 * formationId : string
 *     The unit's formation.
 * bandLo, bandHi : number
 *     The unit's own elevation band (mTAW). Only same-formation pieces that vertically
 *     overlap this band are attributed to the unit (a same-formation region three units away
 *     must not be counted).
 *
 * Returns
 * -------
 * object
 *     ``shape`` + fraction extent + apex reach + which edges it reaches.
 */
export function renderedShape(
  regs: readonly SectionRegion[],
  formationId: string,
  bandLo: number,
  bandHi: number,
): { shape: RenderShape; fracLo: number; fracHi: number; apex: number; reachesLeft: boolean; reachesRight: boolean } {
  let lo = Infinity
  let hi = -Infinity
  for (const r of regs) {
    if (r.formationId !== formationId) continue
    const [rlo, rhi] = elevOverlap(r.polygon, bandLo, bandHi)
    if (rhi <= rlo) continue // no elevation overlap with the unit's band
    const [flo, fhi] = fracExtent(r.polygon)
    if (flo < lo) lo = flo
    if (fhi > hi) hi = fhi
  }
  if (lo === Infinity) return { shape: 'absent', fracLo: 0, fracHi: 0, apex: 0, reachesLeft: false, reachesRight: false }
  const reachesLeft = lo <= FULL_EPS
  const reachesRight = hi >= 1 - FULL_EPS
  let shape: RenderShape
  if (reachesLeft && reachesRight) shape = 'band'
  else if (reachesLeft || reachesRight) shape = 'onlap'
  else shape = 'lens'
  // apex = how far the shape reaches from whichever edge it is anchored to (its widest run).
  const apex = reachesLeft ? hi : reachesRight ? 1 - lo : hi - lo
  return { shape, fracLo: lo, fracHi: hi, apex, reachesLeft, reachesRight }
}

/**
 * OWNER RULING 8e (design partition-engine-v2.md §8) — SAME-FORMATION ENCLOSURE CONFORMS.
 *
 * A flagged unit whose full-width same-formation extent MERGES INTO its own formation's
 * legitimately-tied face is NOT a violation ("it should be one sand" — the owner's traced
 * loop closes ONE face). Operationalised as: the unit's formation carries a MATCHED-PAIR
 * BAND (a drawn/derived same-side same-formation tie — ``collectGapBands``) across THIS gap.
 *
 * Why "same formation has a matched-pair band in the gap" is exactly "enclosed by its own
 * formation's TIED face":
 *   - The unit already renders FULL WIDTH of that formation (the gate flagged it precisely
 *     because the engine traced it as one same-formation face reaching both edges).
 *   - A matched-pair band of that formation in the same gap is tie-anchored at its outer
 *     boundary (``collectGapBands`` requires a same-side, same-formation tie between the two
 *     facing units). v2 traces the unit's extent and that band as ONE contiguous
 *     same-formation face (that merge is *why* the unit reads full-width). Following the lines
 *     — band top-tie down one column around any different-formation minority, across the
 *     tie-anchored basal contact, back up — closes one body. Per-unit scoping drew an
 *     invisible distinction inside that one body: the gate false positive ruling 8e retires.
 *
 * NEGATIVE GUARD (stays flagged — ruling 8): a same-formation full-width render with NO tie
 * of that formation ANYWHERE in the gap is the retired geometric auto-match — two untied
 * same-formation units are OPPOSING LENSES, not one band. ``collectGapBands`` returns no
 * band of that formation → this returns ``false`` → the unit stays flagged. So this blesses
 * ONLY enclosure by a genuinely TIED face, never a blanket same-formation exemption.
 *
 * Parameters
 * ----------
 * bands : readonly GapBand[]
 *     The gap's matched-pair bands (``collectGapBands`` — tie-justified same-formation pairs).
 * formationId : string
 *     The flagged unit's formation.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the unit's formation has a tie-anchored matched-pair band in this gap
 *     (the merged face is one body by construction — ruling 8e exempts it).
 */
export function sameFormationEnclosedByTiedBand(
  bands: readonly GapBand[],
  formationId: string,
): boolean {
  for (const b of bands) if (b.formationId === formationId) return true
  return false
}

/**
 * Shallow TD of a gap (mTAW): the HIGHER of the two facing columns' deepest base elevations.
 * Below this elevation only ONE column has data, so a full-width fill there is the deep-to-deep
 * substrate (owner §8 Q3), NOT a same-formation termination band — the 2/1/0 rule does not apply
 * to it. Mirrors ``partitionFillV2.shapeaudit.zerocorr.ts`` ``shallowTDForGap``.
 */
export function shallowTDForGap(
  left: { units: { baseElev: number }[] },
  right: { units: { baseElev: number }[] },
): number {
  const tdOf = (c: { units: { baseElev: number }[] }): number =>
    Math.min(...c.units.map((u) => u.baseElev))
  return Math.max(tdOf(left), tdOf(right))
}
