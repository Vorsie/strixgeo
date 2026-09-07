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
 * The 2/1/0 outcome (ruling 8l — CORR IS THE LITERAL COUNT of the unit's effectively-tied
 * contacts on that side; owner 2026-07-17):
 *
 *   2 → BAND: BOTH the unit's contacts are effectively tied on this side (a real top-tie +
 *       base-tie, or 8d-rev's top band + a real/derived base tie). A face bounded top AND base
 *       by given line art spans the gap by construction.
 *   1 → ONLAP: exactly ONE contact is tied — a DIRECT correlation edge on its own contact, a
 *       ruling-8a shared contact with a directly-adjacent same-side tied band (a DERIVED onlap),
 *       8d-rev's top band on a first unit, or a bridge anchor. Tip ~0.5, riding that tie — EVEN
 *       between two facing same-formation units (the old matched-pair promotion is deleted; the
 *       BAND LOOK emerges when two facing onlaps meet at 0.5 and the 8j merge welds them).
 *   0 → LENS: neither contact is tied — a small hugging lens around the unit (ruling 8b cap).
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

/**
 * EXACT tie provenance for one tied contact (audit item 6 — TieRef). A corr-1 onlap must
 * follow ITS OWN tie, not "whichever tie sits at that near elevation" — the elevation-guessing
 * ``tieFacingElevAt`` matched the FIRST tie at the shared contact elevation, which can be a
 * DIFFERENT unit's tie landing at a DIFFERENT far endpoint (the ``oneCorrActualTie (a)`` bug).
 *
 * A shared physical contact hands BOTH adjacent units the same ``TieRef`` (ruling 8a, expressed
 * structurally here — the resolved tie is the one edge on that surface; ``ownContact`` says which
 * of THIS unit's two contacts rides it). Derived-band ties (ruling 8a derivation) reference the
 * underlying resolved tie. A first unit's top-band implicit tie carries ``{ kind: 'top-band' }``
 * (no resolved edge — the surface polyline is the tie); its draw keeps the surface-onlap routing.
 */
export type TieRef =
  | { kind: 'resolved'; tie: ResolvedTie; ownContact: 'top' | 'base' }
  | { kind: 'top-band' }

/** Effective per-contact tie state + the collapsed 2/1/0 outcome for one unit-in-a-gap. */
export interface EffectiveCorr {
  /** Top contact effectively tied (direct edge or derived via an adjacent same-side band). */
  topTied: boolean
  /** Base contact effectively tied (direct/derived). */
  baseTied: boolean
  /** Owner's 2/1/0 outcome: 2 = band, 1 = onlap, 0 = lens. */
  corr: 0 | 1 | 2
  /** EXACT provenance of the top tie (the actual edge this unit's top rides), or null if untied. */
  topTie: TieRef | null
  /** EXACT provenance of the base tie, or null if untied. */
  baseTie: TieRef | null
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

/**
 * NARROWED TOP BAND (owner ruling 2026-09-07, part 1): the implicit top-band tie is emitted
 * for a first unit ONLY when the user did NOT hand-draw a correlation on that unit's top
 * contact. When the user tied the first unit's top (a real edge on ``ui === 0`` top of this
 * gap side), the top follows THAT tie polyline, not the top-band surface — so no extra
 * implicit top tie is added on that side. Owner: *"removing top tie = narrow, only when the
 * user has tied the top, no extra top tie is emitted; if only left top is bound no left top
 * is emitted, if only right top is bound no right top is emitted, if both are correlated,
 * then both are not emitted."* Per gap side.
 *
 * Returns true iff an active tie in ``gapIndex`` lands on unit 0's TOP contact on ``side``.
 */
export function firstUnitTopUserTied(
  gapIndex: number,
  side: 'left' | 'right',
  activeTies: readonly ResolvedTie[],
): boolean {
  for (const t of activeTies) {
    if (t.gapIndex !== gapIndex) continue
    const ui = side === 'left' ? t.leftUnitIndex : t.rightUnitIndex
    const s = side === 'left' ? t.leftSide : t.rightSide
    if (ui === 0 && s === 'top') return true
  }
  return false
}

/**
 * Is the gap's implicit TOP BAND suppressed (owner ruling 2026-09-07 part 1)? The top-band
 * (``surface:gi``) polyline is a single per-GAP line joining the two columns' first-litho tops;
 * once the user hand-ties EITHER column's first unit top across this gap, that line no longer
 * describes the top (the drawn tie does), so the whole line is dropped and NEITHER first unit in
 * the gap rides an implicit top tie — each first unit falls back to its own 2/1/0 outcome (a
 * 0-tie first unit becomes a lens, a base-tied one an onlap). Owner: *"above my tie, on the CPTs
 * nothing can flood. There are no ties to the borehole column, so they all become lenses and are
 * closed loops."* A gap with no hand-tied first-unit top keeps the top band exactly as before.
 */
export function gapTopBandSuppressed(
  gapIndex: number,
  activeTies: readonly ResolvedTie[],
): boolean {
  return (
    firstUnitTopUserTied(gapIndex, 'left', activeTies) ||
    firstUnitTopUserTied(gapIndex, 'right', activeTies)
  )
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
 * Resolve the EXACT ``TieRef`` for one of a unit's OWN contacts (audit item 6). Two provenance
 * sources, in priority order — a contact's OWN direct/shared/derived edge always beats a
 * further-away derivation:
 *
 *   1. DIRECT (or 8a shared-contact) — an active tie whose NEAR endpoint on ``side`` sits on THIS
 *      unit's own ``contact`` (its ``ui``/``contact`` == the tie's ``leftUnitIndex``/``leftSide``
 *      for a left look, mirror for right). This is the unit's literal edge on that surface. A
 *      shared physical contact returns the same ``ResolvedTie`` to both adjacent units (ruling 8a
 *      is structural here — one edge on one surface), differing only in ``ownContact``.
 *   2. DERIVED (ruling 8a derivation, base only) — a unit's BASE is derived-tied when the unit
 *      BELOW carries a TOP tie on the shared contact (``§4 increment-2``: a top tie on unit k+1
 *      ties k.base). The ref is that neighbour's resolved tie; ``ownContact`` is this unit's base.
 *
 * Returns the resolved ``TieRef`` for the requested contact, or ``null`` when no edge ties it
 * (the top-band implicit tie is handled separately by ``effectiveCorrForUnit``).
 */
export function tieRefForContact(
  gapIndex: number,
  side: 'left' | 'right',
  ui: number,
  contact: 'top' | 'base',
  activeTies: readonly ResolvedTie[],
): TieRef | null {
  const nearUnit = (t: ResolvedTie): number => (side === 'left' ? t.leftUnitIndex : t.rightUnitIndex)
  const nearSide = (t: ResolvedTie): 'top' | 'base' => (side === 'left' ? t.leftSide : t.rightSide)
  // (1) DIRECT / 8a shared-contact: the tie sits on THIS unit's own ``contact``.
  for (const t of activeTies) {
    if (t.gapIndex !== gapIndex) continue
    if (nearUnit(t) === ui && nearSide(t) === contact) return { kind: 'resolved', tie: t, ownContact: contact }
  }
  // (2) DERIVED base-tie (ruling 8a derivation): a TOP tie on the unit BELOW (ui+1) shares this
  // unit's BASE contact. The ref is that neighbour's tie; this unit's own contact is its base.
  if (contact === 'base') {
    for (const t of activeTies) {
      if (t.gapIndex !== gapIndex) continue
      if (nearUnit(t) === ui + 1 && nearSide(t) === 'top') return { kind: 'resolved', tie: t, ownContact: 'base' }
    }
  }
  return null
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
  // RULING 8l: ``bands`` (the ``collectGapBands`` matched-pair set) no longer drives the corr
  // outcome — the literal contact-tie count does. The parameter is kept for signature stability
  // (the conformance gate passes it) but is inert here.
  void bands
  const direct = flags[ui] ?? { top: false, base: false }
  const derived = derivedBandTies(gapIndex, side, ui, col, facing, activeTies)
  // Owner ruling 2026-09-07 part 1: narrow the 8d-rev implicit top band — once the user hand-ties
  // either column's first-unit top across this gap, the top-band line is dropped for the whole gap
  // (``gapTopBandSuppressed``), so NO first unit here rides an implicit top tie; each falls back to
  // its own 2/1/0 outcome (a 0-tie first unit becomes a lens, not a top-band flood). A gap with no
  // hand-tied first-unit top keeps the top band as before.
  const topBandTied = topBandTies(ui) && !gapTopBandSuppressed(gapIndex, activeTies)
  // RULING 8d-rev (owner, 2026-07-16 evening; design §8 8d-rev). The TOP BAND is an implicit tie
  // for the FIRST unit, so it feeds ``topTied`` (a first unit whose only tie is the top band reads
  // topTied → corr 1 → surface-riding onlap). This survives UNCHANGED under 8l: the top band is
  // one tied contact, counted like any other.
  const topTied = direct.top || derived.topShared || topBandTied
  const baseTied = direct.base || derived.baseShared
  // RULING 8l — CORR IS THE LITERAL COUNT (owner, 2026-07-17, on the 646.74 three-clay column:
  // "the top clay has a top tie, the middle clay has no ties and the bottom clay has a bottom tie.
  // That makes the top a 1corr litho, the middle a 0 corr litho and the bottom a 1 corr litho
  // again!"; design §8 8l). A side's corr = the number of that unit's OWN contacts tied — LITERALLY.
  // The old ruling-8 matched-pair BAND PROMOTION (``isBandMember`` corr-2 from a single same-side
  // same-formation tie) and the ``firstUnitTopBandBand`` special-case are DELETED: the BAND LOOK is
  // now an EMERGENT OUTCOME (two facing same-formation onlaps meet at 0.5, the flood closes, the 8j
  // merge welds one body — bands are what onlaps BECOME).
  //
  // THE BAND COUNT USES REAL OWN-CONTACT TIES, NOT ruling-8a DERIVED-band ties. 8l says each piece
  // "counts its OWN contacts" (design §8 8l(b)) — a real correlation edge on the unit's own top/base
  // (``direct.*``, which already folds the physical shared-contact derivation + bridges) or the
  // 8d-rev top band. A ruling-8a DERIVED-band tie (``derived.topShared``/``baseShared``) is the
  // ADJACENT band's tie sharing this unit's contact — it makes an ONLAP (corr 1, ruling 8a's own
  // words: "a DERIVED onlap"), but two derived ties from DIFFERENT-formation neighbours are a
  // MIXED-BRACKET MINORITY (bidirSweep(b) / convergingStack(a) / coherentStack(a)), NOT a band —
  // counting them as 2 would suppress a minority the design 8e mandates render as its 8b lens. So:
  //   corr 2  ⇐ BOTH own contacts carry a REAL tie (direct edge/bridge OR 8d-rev top band)
  //   corr 1  ⇐ exactly one such REAL own tie, OR any DERIVED tie (an 8a onlap) touches the unit
  //   corr 0  ⇐ no tie of any kind
  const realTop = direct.top || topBandTied
  const realBase = direct.base
  const realCount = (realTop ? 1 : 0) + (realBase ? 1 : 0)
  const hasAnyTie = topTied || baseTied
  const corr: 0 | 1 | 2 = realCount === 2 ? 2 : hasAnyTie ? 1 : 0
  // EXACT tie provenance (audit item 6 — TieRef). For each effectively-tied contact, resolve the
  // ACTUAL edge it rides (``tieRefForContact``: the direct/8a-shared edge on that surface, then the
  // derived base-tie from the unit below). The top-band implicit tie (8d-rev, ui 0) has NO resolved
  // edge — its surface polyline IS the tie — so it carries ``{ kind: 'top-band' }``. A bridge-
  // anchored contact (``direct.*`` set via ``bridgeGapAnchored`` but not an ``activeTies`` edge)
  // resolves to ``null`` here: bridges never reach the corr-1 8m onlap-follow path (a bridge
  // endpoint carrier is handled by ``emitSubstrate`` / ``emitSubTdLenses``, not ``drawTermination``),
  // so no resolved bridge tie is needed for the draw; the ``null`` is the documented representation
  // (the draw half never dereferences a bridge-only TieRef).
  const topTie: TieRef | null = topTied
    ? (tieRefForContact(gapIndex, side, ui, 'top', activeTies) ?? (topBandTied ? { kind: 'top-band' } : null))
    : null
  const baseTie: TieRef | null = baseTied ? tieRefForContact(gapIndex, side, ui, 'base', activeTies) : null
  return { topTied, baseTied, corr, topTie, baseTie }
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
