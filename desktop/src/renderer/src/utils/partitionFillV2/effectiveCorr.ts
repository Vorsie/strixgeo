/**
 * partitionFillV2/effectiveCorr.ts — the SHARED per-unit-per-gap-per-side effective
 * correlation arithmetic (owner ruling 8/8a/8b/8c/8d, design partition-engine-v2.md §8).
 *
 * ONE source of truth for "how many of a unit's two contacts are effectively tied,
 * collapsed to the owner's 2/1/0 outcome" — consumed by BOTH the engine's interval
 * tiler (terminations-first emission, ruling 8c) AND the conformance gate
 * (``partitionFillV2.conformance.diag.test.ts``). Extracting it here means the engine and
 * the gate CANNOT drift: the gate verifies exactly the outcome the engine emitted against.
 *
 * The 2/1/0 outcome (ruling 8/8a/8b/8d, mirroring the engine's own band signal — NOT a
 * naive tied-contact count):
 *
 *   2 → BAND: the unit is a MATCHED-PAIR BAND member (``collectGapBands`` — a same-side,
 *       SAME-FORMATION tie between the two facing units; that pair spans the gap full-width
 *       by construction, §4 increment-7), OR a FIRST unit whose base rides a real/derived
 *       tie (ruling 8d: the top band is an implicit tie, so the first unit bands between the
 *       top band and its base tie). A unit sandwiched between two DIFFERENT-formation tied
 *       bands is a MINORITY (mixed-bracket, §4 residual (b)), NOT a band — so a naive "both
 *       contacts tied → 2" would wrongly count it. Band membership + the ruling-8d first-unit
 *       case are the correct band tests.
 *   1 → ONLAP: the unit is not a band member but a tie touches it — either a DIRECT
 *       correlation edge on its own contact, or a ruling-8a shared contact with a directly-
 *       adjacent same-side tied band (a DERIVED onlap). Tip ~0.5, riding the tie.
 *   0 → LENS: no tie touches the unit and no adjacent band shares a contact.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { collectGapBands, type GapBand } from './emitBands'
import { type ResolvedTie } from './emitCurves'
import { bridgeGapAnchorKey } from './emitSubstrate'
import { type ColumnGeom } from './sectionGeom'

/** A minimal column view — the units' formation ids in stack order (top→down). */
export interface CorrColumn {
  units: { formationId: string }[]
}

/** Effective per-contact tie state + the collapsed 2/1/0 outcome for one unit-in-a-gap. */
export interface EffectiveCorr {
  /** Top contact effectively tied (direct edge or derived via an adjacent same-side band). */
  topTied: boolean
  /** Base contact effectively tied (direct/derived). */
  baseTied: boolean
  /** Owner's 2/1/0 outcome: 2 = band, 1 = onlap, 0 = lens. */
  corr: 0 | 1 | 2
}

/**
 * Direct + derived tied-contact flags per unit index on a column (the engine's
 * ``tiedContacts`` rule, §4 increment-2): a TOP tie on unit k sets k.top AND k-1.base
 * (derived base-tie); a BASE tie sets only k.base. Returns {top,base} per unit index.
 *
 * This is the SINGLE definition of the direct/derived tie flags. ``emitIntervals``'
 * ``tiedContacts`` and the conformance ``tiedFlags`` were byte-identical copies of it —
 * both now delegate here (the ``colIndex``/``bridgeAnchored`` bridge-anchor extension the
 * engine needs is layered on top by ``emitIntervals`` after this base pass).
 */
export function tiedFlags(
  gapIndex: number,
  side: 'left' | 'right',
  nUnits: number,
  activeTies: readonly ResolvedTie[],
  bridgeGapAnchored?: ReadonlySet<string>,
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
  // RULING 8i(e): a jump-tie BRIDGE's anchored contacts feed the 2/1/0 arithmetic — a drawn
  // correlation is a correlation regardless of adjacency. A bridge's near-column anchor ties
  // that contact ONLY toward the gap+side the bridge spans (the directional
  // ``bridgeGapAnchored`` set from ``emitSubstrateBridges``), so a bridge-anchored unit reads
  // corr 1 → onlap riding the bridge, while pass-through columns the bridge merely CROSSES
  // (never anchoring) stay untied → their units lens. The derived-base asymmetry is already
  // encoded in the set (an anchored top of unit k registered base of unit k-1), so a plain
  // OR here matches ``setTop``/``setBase`` without re-deriving. Direction-blind
  // ``bridgeAnchorKey`` (the sweep's suppression + the seam bracket lookup) is unchanged.
  if (bridgeGapAnchored) {
    for (let ui = 0; ui < nUnits; ui++) {
      if (bridgeGapAnchored.has(bridgeGapAnchorKey(gapIndex, side, ui, 'top'))) flags[ui].top = true
      if (bridgeGapAnchored.has(bridgeGapAnchorKey(gapIndex, side, ui, 'base'))) flags[ui].base = true
    }
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
  col: CorrColumn,
  facing: CorrColumn,
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
    // Ruling 8a derives ONLY through the shared physical contact: the neighbour's tie
    // must sit ON the surface we share, not merely anywhere on a neighbouring band
    // member. An above-neighbour shares MY TOP via ITS BASE (so its tie must be
    // base-side); a below-neighbour shares MY BASE via ITS TOP (tie must be top-side).
    // Without the side check, a top-top band above leaked a derived tie onto this
    // unit's top through a contact metres away from the actual tie — producing the
    // contradiction that the band unit's own base read untied while the unit below's
    // top (the SAME surface) read tied (owner-caught, CS1 col3 SILT, 2026-07-16).
    const tieSide = t.leftSide
    if (uIdx === ui - 1 && tieSide === 'base') topShared = true // above unit's BASE = my top
    if (uIdx === ui + 1 && tieSide === 'top') baseShared = true // below unit's TOP = my base
  }
  return { topShared, baseShared }
}

/**
 * Is this unit a member of a MATCHED-PAIR BAND across the gap (the engine's own signal,
 * ``collectGapBands``: a same-side [top-top or base-base] tie between two same-formation
 * facing units)? Such a unit bands FULL-WIDTH by construction — the owner's "2 → bands"
 * outcome regardless of whether the unit's OTHER contact carries its own explicit tie.
 */
export function isBandMember(bands: readonly GapBand[], side: 'left' | 'right', ui: number): boolean {
  for (const b of bands) if ((side === 'left' ? b.leftUnitIndex : b.rightUnitIndex) === ui) return true
  return false
}

/**
 * Ruling 8d (design §8): the TOP BAND is an IMPLICIT TIE for FIRST units — the top-band
 * polyline (``emitSurfaceCurves`` → ``firstLithoTopElev``) spans every gap, so the FIRST
 * unit's TOP contact is tied by construction. A first unit whose BASE also rides a
 * real/derived tie is therefore 2-corr. Reports whether the unit's TOP is implicitly tied
 * by the top band: true iff ``ui === 0``. The base still needs its own real/derived tie
 * for 2-corr (applied by ``effectiveCorrForUnit``).
 */
export function topBandTies(ui: number): boolean {
  return ui === 0
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

/**
 * The effective 2/1/0 correlation outcome for ONE unit into ONE gap on ONE side — the
 * shared arithmetic the engine and the conformance gate both consume (ruling 8c: the
 * engine emits the termination the outcome names; the gate checks the render matches).
 *
 * Parameters
 * ----------
 * gapIndex : number
 *     The gap (left column index).
 * side : 'left' | 'right'
 *     Which facing column the unit lives on for this gap.
 * ui : number
 *     The unit index on its column.
 * col, facing : CorrColumn
 *     The unit's column and the facing column (formation ids in stack order).
 * flags : { top; base }[]
 *     Per-unit direct/derived tie flags (from ``tiedFlags``, possibly bridge-augmented by
 *     the engine before the call).
 * bands : readonly GapBand[]
 *     The gap's matched-pair bands (``collectGapBands``).
 * activeTies : readonly ResolvedTie[]
 *     The gap's active ties.
 *
 * Returns
 * -------
 * EffectiveCorr
 *     The effective top/base tie flags + the collapsed 2/1/0 outcome.
 */
export function effectiveCorrForUnit(
  gapIndex: number,
  side: 'left' | 'right',
  ui: number,
  col: CorrColumn,
  facing: CorrColumn,
  flags: { top: boolean; base: boolean }[],
  bands: readonly GapBand[],
  activeTies: readonly ResolvedTie[],
): EffectiveCorr {
  const direct = flags[ui] ?? { top: false, base: false }
  const derived = derivedBandTies(gapIndex, side, ui, col, facing, activeTies)
  const topBandTied = topBandTies(ui)
  // RULING 8d-rev (owner, 2026-07-16 evening, dogfeeding the CS1 walkthrough — "top band counts
  // as one correlation, this keeps it consistent"; design §8 8d-rev). The TOP BAND is an implicit
  // tie for the FIRST unit, so it feeds ``topTied``/``hasAnchor`` (not only the 2-corr
  // ``firstUnitTopBandBand`` case): a first unit whose ONLY tie is the top band is 1-corr and
  // ONLAPS riding the surface (``topTied`` true → the sweep picks the top as the tied leg, apex on
  // the top-band polyline). A first unit with top band + real/derived base tie stays 2-corr band
  // (``firstUnitTopBandBand`` below, unchanged). Model-wide effect: every untied first unit flips
  // lens → surface-riding onlap. The gate + LENS_AUDIT inherit via this shared arithmetic (corr-0
  // populations shrink — first units leave).
  const topTied = direct.top || derived.topShared || topBandTied
  const baseTied = direct.base || derived.baseShared
  const bandMember = isBandMember(bands, side, ui)
  const firstUnitTopBandBand = topBandTied && baseTied
  const hasAnchor = unitHasDirectTie(gapIndex, side, ui, activeTies) || topTied || baseTied
  const corr: 0 | 1 | 2 = bandMember || firstUnitTopBandBand ? 2 : hasAnchor ? 1 : 0
  return { topTied, baseTied, corr }
}

/**
 * Convenience wrapper: compute every unit's effective corr for ONE side of ONE gap. The
 * engine calls this once per (gap, side) to drive terminations-first emission; the gate
 * calls ``effectiveCorrForUnit`` per unit (it needs the render comparison inline). Uses
 * ``collectGapBands`` + ``tiedFlags`` internally so a caller supplies only the columns +
 * active ties.
 */
export function effectiveCorrForSide(
  gapIndex: number,
  side: 'left' | 'right',
  col: ColumnGeom,
  facing: ColumnGeom,
  left: ColumnGeom,
  right: ColumnGeom,
  activeTies: readonly ResolvedTie[],
  bridgeGapAnchored?: ReadonlySet<string>,
): EffectiveCorr[] {
  const bands = collectGapBands(gapIndex, left, right, activeTies)
  // ``flags`` folds the bridge-anchored contacts (ruling 8i(e)) so a bridge-near unit reads
  // topTied/baseTied → ``hasAnchor`` → corr 1. ``effectiveCorrForUnit`` needs no extra bridge
  // arg: the tie state it consumes is already in ``flags``.
  const flags = tiedFlags(gapIndex, side, col.units.length, activeTies, bridgeGapAnchored)
  return col.units.map((_, ui) => effectiveCorrForUnit(gapIndex, side, ui, col, facing, flags, bands, activeTies))
}
