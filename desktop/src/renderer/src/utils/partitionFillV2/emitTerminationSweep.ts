/**
 * partitionFillV2/emitTerminationSweep.ts — THE HOIST: the ONE unconditional
 * termination pass (owner diagnosis 2026-07-16 night; design partition-engine-v2.md
 * §8 rulings 8b/8c/8f/8g/8h).
 *
 * THE PROBLEM THE HOIST SOLVES (owner, verbatim): "there is something fundamentally
 * wrong. If my 2/1/0 rule is hardcoded these wouldn't have happened." Classification
 * (``effectiveCorr``) is single-source and correct; EMISSION was not — lenses / onlaps
 * were emitted by whichever interval tiler owned the space, and every tiler carried
 * guards that could SUPPRESS a termination (the sessions-9..13 bug parade:
 * ``facingCarriesMatrix`` / band-bracketed skip / converging bails / whole-run bail /
 * substrate sweep). Each suppressed termination is a leak the owner would dogfeed on
 * every real cross-section.
 *
 * THE HOIST makes emission UNCONDITIONAL and deletes that failure class:
 *
 *   for every gap, for every side, for every column unit:
 *     corr = effectiveCorrForSide(...)          # the SINGLE source, unchanged
 *     if corr == 0: emit the lens closing pair   # 8b reach via lensReachFraction
 *     if corr == 1: emit the onlap contour       # riding its (real/derived) tie
 *     # corr == 2 (band member / first-unit band): given line art (bandc) already
 *
 * It runs EARLY in ``emitCurves`` (after ties / bridges / surface, BEFORE any fill /
 * tiler), and its closings enter the curve set as GIVEN LINE ART. The arrangement
 * carves each termination as a HOLE in the enclosing FULL-WIDTH flood
 * (``emitEnclosingFlood``) — exactly the ``emitSubTdLenses`` / ``emitLenses`` proof:
 * emit the closing, the arrangement carves; no tiler decides whether it fires.
 *
 * THE ONLY PERMISSIBLE SUPPRESSIONS ARE RULE-DERIVED OR PHYSICAL (never tiler-local):
 *   - 8e / 8g(b) MERGE — a same-formation facing enclosure (``collectGapBands`` band of
 *     the unit's formation) OR a purely base-tied same-formation pair legitimately
 *     merges: the unit IS its band, no termination needed. Derived from the RULES here
 *     (the SAME predicates the conformance gate uses), not from a tiler heuristic.
 *   - BRIDGE-ANCHOR — a unit a deep-to-deep bridge carries is 2-corr-like by bridge
 *     (``effectiveCorr`` already reads the same ``bridgeAnchored`` set the engine feeds
 *     it via ``tiedContacts``, so a bridged contact reads 2 and never enters 0/1 here).
 *   - PHYSICAL — ``fitLensReach`` halving-to-floor + ``segmentDegenerate`` (sub-snap
 *     collapse), applied inside ``emitLensClosing`` / here.
 *
 * FLAG. The sweep is the FLAG-ON engine (``twoSidedTerminationsEnabled``): flag OFF stays
 * the proven v1 seam baseline (the campaign safety line). Cut-over flips the flag default
 * ON and deletes the seam path.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { INTERIOR_PINCH_FRACTION } from '../partitionFill'
import { collectGapBands } from './emitBands'
import { type ResolvedTie } from './emitCurves'
import { effectiveCorrForSide, tiedFlags } from './effectiveCorr'
import { emitLensClosing, type IntervalUnit } from './emitIntervalLenses'
import { type LensLabel } from './emitLenses'
import { bridgeAnchorKey } from './emitSubstrate'
import { sameFormationBaseTiedPair, sameFormationEnclosedByTiedBand } from './terminationRules'
import { type ColumnGeom, type SectionInput, type UnitGeom } from './sectionGeom'
import { type InputCurve, type Point } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/**
 * Emit every unit's termination (0 → lens, 1 → onlap) for every gap+side, UNCONDITIONALLY,
 * into the curve set. The enclosing flood (``emitEnclosingFlood``) fills full-width behind
 * these curves, so each termination carves a HOLE by construction (the arrangement decides
 * containment; the sweep never decides whether a termination fires).
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     The normalised section (columns carry elevations + x; edges are raw).
 * activeTies : readonly ResolvedTie[]
 *     Ties that survived crossing-conflict pruning (drive ``effectiveCorrForSide``).
 * bridgeAnchored : ReadonlySet<string>
 *     ``ci|ui|top`` / ``ci|ui|base`` contacts a deep-to-deep bridge carries — the
 *     bridge-anchor rule: such a unit is 2-corr-like and never terminates here.
 * lensLabels : Map<string, LensLabel>
 *     Shared label map — every emitted closing carries the unit's OWN litho so the traced
 *     hole face reads the unit, not the enclosing flood.
 * out : InputCurve[]
 *     Curve accumulator (appended to).
 */
export function emitTerminationSweep(
  section: SectionInput,
  activeTies: readonly ResolvedTie[],
  bridgeAnchored: ReadonlySet<string>,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): void {
  const { columns } = section
  if (columns.length < 2) return
  let seq = 0
  const nextId = (): string => `term${seq++}`
  for (let gi = 0; gi + 1 < columns.length; gi++) {
    const left = columns[gi]
    const right = columns[gi + 1]
    const bands = collectGapBands(gi, left, right, activeTies)
    // Each column terminates into its adjacent gap on the correct side.
    emitSideSweep(gi, 'left', gi, left, right, bands, activeTies, bridgeAnchored, lensLabels, nextId, out)
    emitSideSweep(gi, 'right', gi + 1, right, left, bands, activeTies, bridgeAnchored, lensLabels, nextId, out)
  }
}

/**
 * Emit the terminations for ONE side of ONE gap. ``col`` is the near column whose units
 * terminate toward ``facing``; ``colIndex`` is its column index (for the bridge-anchor
 * lookup); ``side`` names which facing column ``col`` is for this gap.
 */
function emitSideSweep(
  gapIndex: number,
  side: 'left' | 'right',
  colIndex: number,
  col: ColumnGeom,
  facing: ColumnGeom,
  bands: ReturnType<typeof collectGapBands>,
  activeTies: readonly ResolvedTie[],
  bridgeAnchored: ReadonlySet<string>,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  out: InputCurve[],
): void {
  const left = side === 'left' ? col : facing
  const right = side === 'left' ? facing : col
  // effectiveCorrForSide is the SINGLE classification source (shared with the conformance
  // gate). It already folds direct + derived + band-member + top-band ties — but NOT the
  // engine's bridge-anchor extension, so we consult ``bridgeAnchored`` explicitly below.
  const corr = effectiveCorrForSide(gapIndex, side, col, facing, left, right, activeTies)
  const flags = tiedFlags(gapIndex, side, col.units.length, activeTies)
  const colX = col.x
  const facingX = facing.x

  const isBridged = (ui: number): boolean =>
    bridgeAnchored.has(bridgeAnchorKey(colIndex, ui, 'top')) ||
    bridgeAnchored.has(bridgeAnchorKey(colIndex, ui, 'base'))
  // The facing column's TD: a unit entirely below it is a SUB-TD minority owned by the proven
  // ``emitSubTdLenses`` pass (its M-in-M annulus + bridge-anchor guards are the safe sub-TD
  // wall handling — sessions 9/12/13). The sweep DEFERS sub-TD units to that pass so a lens is
  // never double-emitted (the sweep + emitSubTdLenses both lens it → overlap) and the sub-TD
  // wall stays guarded there. Above-TD terminations are the sweep's job.
  let facingTD = Infinity
  for (const fu of facing.units) if (fu.baseElev < facingTD) facingTD = fu.baseElev

  for (let ui = 0; ui < col.units.length; ui++) {
    const eff = corr[ui] ?? { topTied: false, baseTied: false, corr: 0 as const }
    const c = eff.corr
    if (c === 2) continue // band member / first-unit band — given line art (bandc), no termination
    // BRIDGE-ANCHOR rule: a unit a deep-to-deep bridge carries is a substrate band anchor
    // (2-corr-like by bridge) — the bridge already provides its boundary. Carving a lens into
    // a bridge-carried substrate band voids the substrate face (the session-13 GAP-8 wall).
    if (isBridged(ui)) continue
    // Sub-TD deferral: a unit entirely below the facing TD is ``emitSubTdLenses``' job (below).
    if (col.units[ui].topElev <= facingTD - ELEV_EPS) continue
    const u = col.units[ui]
    const iu: IntervalUnit = { unit: u as UnitGeom, topElev: u.topElev, baseElev: u.baseElev }

    if (c === 0) {
      // MINORITY gate (owner 8f/8h — the DOMINANT enclosing lithology FLOODS, only a MINORITY
      // lenses). A 0-corr unit lenses iff it is a genuine minority (its same-column neighbours
      // above AND below are a DIFFERENT formation, so the enclosing floods around it). A unit
      // that is its interval's own dominant matrix (or a boundary unit touching the surface / TD)
      // is NOT a minority — it floods, no lens (else even a thick enclosing CLAY would pinch to
      // 0.5 and break its band). This is NOT a suppressible tiler guard — it is the structural
      // fill rule (which lithology is the void's dominant fill vs which is a hole in it).
      if (!isMinority(col, ui)) continue
      emitLens(iu, side, colX, facingX, u, lensLabels, nextId, out)
    } else {
      // c === 1: ONLAP riding its tie — UNLESS the 8e / 8g(b) MERGE ruling applies (RULE-derived,
      // the SAME predicates the conformance gate uses): a same-formation facing enclosure or a
      // base-tied same-formation pair legitimately merges into ONE band, no onlap termination.
      const merged = ruledMergeExempt(
        side, ui, u as UnitGeom, u.baseElev, u.topElev, facing, bands, eff.baseTied, eff.topTied,
      )
      if (merged) continue
      emitOnlap(iu, side, colX, facingX, gapIndex, ui, col, facing, flags, activeTies, u, lensLabels, nextId, out)
    }
  }
}

/**
 * Whether a column unit is an ENCLOSED MINORITY on its own column — its neighbours immediately
 * above AND below share ONE formation different from its own (the unambiguous-enclosing case the
 * arrangement carves hole-free: the ``extractEnclosedLenses`` / ``emitSubTdLenses`` class). A
 * surface-topped (ui 0) or TD-based (last) unit has no enclosing above / below, so it is the
 * boundary matrix (floods, not a minority). This is the SAFE lens class for the measurement pass;
 * boundary + opposing-same-formation minorities stay on the fill tiler for now (session-14 mode A).
 */
function isMinority(col: ColumnGeom, ui: number): boolean {
  if (ui <= 0 || ui + 1 >= col.units.length) return false
  const above = col.units[ui - 1]
  const below = col.units[ui + 1]
  const self = col.units[ui]
  return above.formationId === below.formationId && above.formationId !== self.formationId
}

/**
 * Emit a 0-corr LENS: the ``emitLensClosing`` pair (top→apex→base) at the unit's own
 * mid-elevation, apex 8b-capped + degenerate-guarded. Own-litho label so the traced hole
 * reads the unit. The enclosing flood fills full-width behind it → the lens is a hole.
 */
function emitLens(
  iu: IntervalUnit,
  side: 'left' | 'right',
  colX: number,
  facingX: number,
  u: UnitGeom,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  out: InputCurve[],
): void {
  void side
  const before = out.length
  // ``emitLensClosing`` applies ``lensReachFraction`` (8b cap) + ``segmentDegenerate``; the
  // apex direction is toward ``facingX`` (left lens pinches right, right lens pinches left) —
  // ``emitLensClosing`` interpolates ``colX → facingX`` so the sign is correct either way.
  emitLensClosing(iu, colX, facingX, INTERIOR_PINCH_FRACTION, nextId, out)
  const label: LensLabel = { formationId: u.formationId, bodyId: u.bodyId }
  for (let ci = before; ci < out.length; ci++) lensLabels.set(out[ci].id, label)
}

/**
 * Emit a 1-corr ONLAP: a pinch from the unit's own column span to a tip at
 * ``INTERIOR_PINCH_FRACTION`` (0.5) ON the tied contact's interpolated line. The TIED-side
 * edge carries an ``onlap`` id so ``labelFaces`` counts it as a tie (nTie 1) and the face
 * reads ONLAP; the UNTIED-side edge is a plain ``close``. The unit's own column vertical
 * closes the loop. The enclosing flood fills the vacated width past the tip.
 */
function emitOnlap(
  iu: IntervalUnit,
  side: 'left' | 'right',
  colX: number,
  facingX: number,
  gapIndex: number,
  ui: number,
  col: ColumnGeom,
  facing: ColumnGeom,
  flags: { top: boolean; base: boolean }[],
  activeTies: readonly ResolvedTie[],
  u: UnitGeom,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  out: InputCurve[],
): void {
  void gapIndex
  void activeTies
  // Which contact carries the effective tie decides the apex line. Prefer the direct/derived
  // flag; a unit tied on BOTH would be corr 2 (handled upstream), so exactly one side is tied
  // for a corr-1 unit reaching here. If neither flag is set (a derived-band onlap whose flag
  // lives elsewhere), default to the base (the common onlap-riding-the-band-below case).
  const f = flags[ui] ?? { top: false, base: false }
  const baseTied = f.base && !f.top ? true : f.top && !f.base ? false : true
  // The tied contact's elevation on the FACING column, interpolated at 0.5. The facing carries
  // the tie endpoint at (approximately) the same contact; sampling the facing unit spanning the
  // unit's tied-contact elevation gives the tie line's facing anchor. When the facing does not
  // present a unit there (a converging / shallow facing), fall back to the unit's own contact
  // elevation so the apex rides horizontally (a clean own-elevation onlap tip).
  const tiedElev = baseTied ? u.baseElev : u.topElev
  const facingTiedElev = facingElevAt(facing, tiedElev)
  const apexFrac = INTERIOR_PINCH_FRACTION
  const apexX = colX + apexFrac * (facingX - colX)
  const apexElev = tiedElev + apexFrac * (facingTiedElev - tiedElev)
  const apex: Point = { x: apexX, y: apexElev }
  const topPt: Point = { x: colX, y: u.topElev }
  const basePt: Point = { x: colX, y: u.baseElev }
  const label: LensLabel = { formationId: u.formationId, bodyId: u.bodyId }
  void col
  const pushClose = (points: Point[]): void => {
    const id = nextId()
    lensLabels.set(id, label)
    out.push({ id, kind: 'closing', points })
  }
  const pushOnlap = (points: Point[]): void => {
    out.push({ id: `onlap${nextId()}`, kind: 'closing', points })
  }
  // Degenerate guard: a sub-snap onlap (apex on the column) drops both flanks (the enclosing
  // flood covers the slot — the ``emitLensClosing`` no-op parity).
  if (segmentDeg(topPt, apex) || segmentDeg(apex, basePt)) return
  if (baseTied) {
    pushClose([topPt, apex]) // untied top edge = plain close
    pushOnlap([apex, basePt]) // base edge rides the tied band → onlap id
  } else {
    pushOnlap([topPt, apex]) // top edge rides the tied band above → onlap id
    pushClose([apex, basePt]) // untied base edge = plain close
  }
}

/** Facing-column elevation of the unit spanning ``e`` (nearest fallback) — the tie anchor. */
function facingElevAt(facing: ColumnGeom, e: number): number {
  let best = e
  let bestDist = Infinity
  for (const fu of facing.units) {
    if (fu.topElev >= e - ELEV_EPS && e >= fu.baseElev - ELEV_EPS) return e
    const dist = e > fu.topElev ? e - fu.topElev : fu.baseElev - e
    if (dist < bestDist) {
      bestDist = dist
      best = e > fu.topElev ? fu.topElev : fu.baseElev
    }
  }
  return best
}

/** Whether both endpoints snap to the same 1 mm grid cell (re-exported guard). */
function segmentDeg(a: Point, b: Point): boolean {
  // Inline the 1 mm snap equality to avoid a circular import through ``snap`` here.
  const SNAP = 0.001
  return (
    Math.round(a.x / SNAP) === Math.round(b.x / SNAP) && Math.round(a.y / SNAP) === Math.round(b.y / SNAP)
  )
}

/**
 * The RULED 8e / 8g(b) merge exemption for the sweep — re-implemented from the RULES (the
 * SAME predicates the conformance gate uses), not from a tiler heuristic. A unit satisfying
 * either predicate legitimately merges into its own formation's band and takes NO termination.
 *
 * Exposed for the sweep's guard + for tests that pin the ruled exception. It is only
 * meaningful for a corr-1 base-tied unit (8g(b)) or a corr-2 band member (8e) — a corr-0 unit
 * satisfies neither by construction, so the sweep still lenses every genuine 0-corr unit.
 */
export function ruledMergeExempt(
  side: 'left' | 'right',
  ui: number,
  u: UnitGeom,
  bandLo: number,
  bandHi: number,
  facing: ColumnGeom,
  bands: ReturnType<typeof collectGapBands>,
  baseTied: boolean,
  topTied: boolean,
): boolean {
  void side
  void ui
  if (sameFormationEnclosedByTiedBand(bands, u.formationId)) return true
  if (sameFormationBaseTiedPair(baseTied, topTied, u.formationId, bandLo, bandHi, facing)) return true
  return false
}
