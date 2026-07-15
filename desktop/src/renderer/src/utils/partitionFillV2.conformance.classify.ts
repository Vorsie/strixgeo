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
import { type ResolvedTie } from './partitionFillV2/emitCurves'
import { type GapBand } from './partitionFillV2/emitBands'

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
 * Direct + derived tied-contact flags per unit index on a column (the engine's
 * ``tiedContacts`` rule, §4 increment-2): a TOP tie on unit k sets k.top AND k-1.base
 * (derived base-tie); a BASE tie sets only k.base. Returns {top,base} per unit index.
 */
export function tiedFlags(
  gapIndex: number,
  side: 'left' | 'right',
  nUnits: number,
  activeTies: readonly ResolvedTie[],
): { top: boolean; base: boolean }[] {
  const flags = Array.from({ length: nUnits }, () => ({ top: false, base: false }))
  const setTop = (ui: number): void => {
    if (ui < 0 || ui >= nUnits) return
    flags[ui].top = true
    if (ui > 0) flags[ui - 1].base = true // derived base-tie (§4 increment-2)
  }
  const setBase = (ui: number): void => {
    if (ui < 0 || ui >= nUnits) return
    flags[ui].base = true
  }
  for (const t of activeTies) {
    if (t.gapIndex !== gapIndex) continue
    const ui = side === 'left' ? t.leftUnitIndex : t.rightUnitIndex
    const s = side === 'left' ? t.leftSide : t.rightSide
    if (s === 'top') setTop(ui)
    else setBase(ui)
  }
  return flags
}

/**
 * Whether the unit's contact is tied DERIVED through a shared contact with a directly
 * adjacent SAME-SIDE tied band (top-top / base-base, same formation on both facing columns):
 * an adjacent-ABOVE tied band shares this unit's TOP contact; an adjacent-BELOW tied band
 * shares its BASE contact. Owner's ruling-8a derived-tie condition.
 */
export function derivedBandTies(
  gapIndex: number,
  side: 'left' | 'right',
  ui: number,
  col: { units: { formationId: string }[] },
  facing: { units: { formationId: string }[] },
  activeTies: readonly ResolvedTie[],
): { topShared: boolean; baseShared: boolean } {
  let topShared = false
  let baseShared = false
  for (const t of activeTies) {
    if (t.gapIndex !== gapIndex) continue
    if (t.leftSide !== t.rightSide) continue // symmetric band only
    const uIdx = side === 'left' ? t.leftUnitIndex : t.rightUnitIndex
    const fIdx = side === 'left' ? t.rightUnitIndex : t.leftUnitIndex
    const lu = col.units[uIdx]
    const fu = facing.units[fIdx]
    if (!lu || !fu || lu.formationId !== fu.formationId) continue
    if (uIdx === ui - 1) topShared = true // above band shares my top
    if (uIdx === ui + 1) baseShared = true // below band shares my base
  }
  return { topShared, baseShared }
}

/**
 * Is this unit a member of a MATCHED-PAIR BAND across the gap (the engine's own signal,
 * ``collectGapBands``: a same-side [top-top or base-base] tie between two same-formation
 * facing units)? Such a unit bands FULL-WIDTH by construction — the band quad runs from the
 * tied interface down to each column's own base (design §4 increment-7 band-first tiling).
 * This is the owner's "2 → bands" outcome regardless of whether the unit's OTHER contact
 * carries its own explicit tie: a matched-pair band spans the gap.
 */
export function isBandMember(bands: readonly GapBand[], side: 'left' | 'right', ui: number): boolean {
  for (const b of bands) if ((side === 'left' ? b.leftUnitIndex : b.rightUnitIndex) === ui) return true
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

/** Does any active tie in the gap touch this unit's own contact (top or base), direct? */
export function unitHasDirectTie(
  gapIndex: number,
  side: 'left' | 'right',
  ui: number,
  activeTies: readonly ResolvedTie[],
): boolean {
  for (const t of activeTies) {
    if (t.gapIndex !== gapIndex) continue
    if ((side === 'left' ? t.leftUnitIndex : t.rightUnitIndex) === ui) return true
  }
  return false
}
