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
import { facingMatrixLabel } from './facingMatrix'
import { lensReachFraction } from './lensReach'
import { type LensLabel } from './emitLenses'
import { bridgeAnchorKey } from './emitSubstrate'
import { sameFormationBaseTiedPair, sameFormationEnclosedByTiedBand } from './terminationRules'
import { type ColumnGeom, type SectionInput, type UnitGeom } from './sectionGeom'
import { type InputCurve, type Point } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/**
 * Sub-snap-width gap threshold (metres): two columns closer than this cannot resolve a lateral
 * pinch — the interbedded units collapse under the 1 mm snap, so the sweep emits NO terminations
 * and the flood fills full-width per interval (round-3 Target 2; CS1 col21/22 gap21 = 0.17 m).
 * Well below the next-narrowest real gap (metres), so ordinary gaps are unaffected.
 */
const SUB_SNAP_GAP_M = 0.3

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
  // A SEPARATE ``flood``-prefixed id space for the vacated-wedge closures (``labelFaces``
  // stamps a ``flood`` face from the flood label as a BAND — the emitLonePinch device).
  let fseq = 0
  const nextFloodId = (): string => `floodsw${fseq++}`
  for (let gi = 0; gi + 1 < columns.length; gi++) {
    const left = columns[gi]
    const right = columns[gi + 1]
    // SUB-SNAP-WIDTH GAP GUARD (round-3 Target 2, generalising the session-10 degenerate-flank
    // guard to the whole gap). When two columns are closer than ``SUB_SNAP_GAP_M`` (CS1 col21/22
    // gap21 = 0.17 m), the interbedded SILT/ZAND pinches collapse under the 1 mm snap and every
    // lens/onlap apex lands within a snap cell or two of a column — the pinch geometry degenerates
    // physically (a lateral pinch cannot resolve across 17 cm). Emitting terminations there leaves
    // triangular sub-snap residues between mis-meeting apexes (20 above-TD holes). The physical
    // truth for two boreholes 17 cm apart is a FULL-WIDTH band per interval — so the sweep emits
    // NOTHING for the gap and ``emitEnclosingFlood`` fills each interval full-width between its
    // brackets. The threshold sits far below the next-narrowest real gap (metres), so no ordinary
    // gap changes behaviour.
    if (right.x - left.x < SUB_SNAP_GAP_M) continue
    const bands = collectGapBands(gi, left, right, activeTies)
    // Each column terminates into its adjacent gap on the correct side.
    emitSideSweep(gi, 'left', gi, left, right, bands, activeTies, bridgeAnchored, lensLabels, nextId, nextFloodId, out)
    emitSideSweep(gi, 'right', gi + 1, right, left, bands, activeTies, bridgeAnchored, lensLabels, nextId, nextFloodId, out)
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
  nextFloodId: () => string,
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
      // MINORITY gate widened (round-2 Target 2, owner 8h phase 1): a 0-corr INTERIOR unit is a
      // genuine minority whenever BOTH its own-column neighbours are a DIFFERENT formation from it —
      // NOT only when those neighbours are the SAME formation (the round-1 unambiguous-enclosing
      // case). A MIXED-bracket interior minority (e.g. KLEI above, SILT below, VEEN self — the
      // Tie-6/9/11 VEEN class the v1 lone-pinch already lenses) must also lens, else it fills
      // full-width and reads a 0-corr-not-lens violation. Boundary units (ui 0 / last, touching
      // surface / TD) stay EXCLUDED — they are the dominant matrix that FLOODS (pinching them to
      // 0.5 breaks their band → holes, the measured +59-hole regression of the full widening).
      if (!isMinorityWide(col, ui)) continue
      emitLens(iu, side, colX, facingX, facing, u, lensLabels, nextId, nextFloodId, out)
    } else {
      // c === 1: ONLAP riding its tie — UNLESS the 8e / 8g(b) MERGE ruling applies (RULE-derived,
      // the SAME predicates the conformance gate uses): a same-formation facing enclosure or a
      // base-tied same-formation pair legitimately merges into ONE band, no onlap termination.
      const merged = ruledMergeExempt(
        side, ui, u as UnitGeom, u.baseElev, u.topElev, facing, bands, eff.baseTied, eff.topTied,
      )
      if (merged) continue
      emitOnlap(iu, side, colX, facingX, gapIndex, ui, col, facing, flags, activeTies, u, lensLabels, nextId, nextFloodId, out)
    }
  }
}

/**
 * The WIDENED minority test (round-2 Target 2): an INTERIOR unit is a minority whenever BOTH its
 * immediate neighbours are a DIFFERENT formation from it. This is the round-1 same-formation
 * enclosure (above === below ≠ self, the unambiguous ``extractEnclosedLenses`` / ``emitSubTdLenses``
 * class) PLUS the MIXED-bracket case (above ≠ below, both ≠ self): a mixed-bracket interior minority
 * (KLEI above, SILT below, VEEN self — the Tie-6/9/11 VEEN class the v1 lone-pinch already lenses)
 * still lenses — its own litho is a hole in the void; ``emitLens`` floods the top wedge from the
 * above matrix and the base wedge from the below matrix (both-flank flood covers both). Boundary
 * units (ui 0 / last) stay EXCLUDED: they touch surface / TD and are the dominant flooding matrix,
 * never a lens (pinching a dominant matrix to 0.5 breaks its band → the measured +59-hole regression
 * of firing the lens for every 0-corr unit).
 */
function isMinorityWide(col: ColumnGeom, ui: number): boolean {
  if (ui <= 0 || ui + 1 >= col.units.length) return false
  const above = col.units[ui - 1]
  const below = col.units[ui + 1]
  const self = col.units[ui]
  return above.formationId !== self.formationId && below.formationId !== self.formationId
}

/**
 * Emit a 0-corr LENS: the ``emitLensClosing`` pair (top→apex→base) at the unit's own
 * mid-elevation, apex 8b-capped + degenerate-guarded. Own-litho label so the traced hole
 * reads the unit. The FACING enclosing formation floods the vacated wedge PAST the apex
 * (``emitFloodWedge`` — the emitLonePinch ``floodFrom`` device) so the space between the
 * apex and the facing column traces hole-free as a BAND, never an untraced hole.
 */
function emitLens(
  iu: IntervalUnit,
  side: 'left' | 'right',
  colX: number,
  facingX: number,
  facing: ColumnGeom,
  u: UnitGeom,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  nextFloodId: () => string,
  out: InputCurve[],
): void {
  void side
  // The 8b-capped apex fraction — the SAME value ``emitLensClosing`` uses internally (so the
  // flood wedge shares the exact apex point the lens closing emits, no seam gap between them).
  const apexFrac = Math.min(INTERIOR_PINCH_FRACTION, lensReachFraction(u.topElev - u.baseElev, facingX - colX))
  const apexX = colX + apexFrac * (facingX - colX)
  const apexElev = (u.topElev + u.baseElev) / 2
  const before = out.length
  // ``emitLensClosing`` applies ``lensReachFraction`` (8b cap) + ``segmentDegenerate``; the
  // apex direction is toward ``facingX`` (left lens pinches right, right lens pinches left) —
  // ``emitLensClosing`` interpolates ``colX → facingX`` so the sign is correct either way.
  emitLensClosing(iu, colX, facingX, INTERIOR_PINCH_FRACTION, nextId, out)
  const label: LensLabel = { formationId: u.formationId, bodyId: u.bodyId }
  const emitted = out.length > before // the lens closing may no-op (degenerate) — skip the wedge too
  for (let ci = before; ci < out.length; ci++) lensLabels.set(out[ci].id, label)
  if (emitted) {
    // 0-corr LENS: both sides enclosing → both flood wedges (skipSide null).
    emitFloodWedge(colX, facingX, facing, u.topElev, u.baseElev, apexX, apexElev, null, nextFloodId, lensLabels, out)
  }
}

/**
 * Emit the FLOOD-CLOSURE wedge that fills the vacated space PAST a termination apex (the
 * emitLonePinch ``floodFrom`` device — design partition-engine-v2.md §4 finding A). The
 * terminating unit lives on ``col`` and pinches to ``apex``; the space between the apex and
 * the FACING column is claimed by the facing column's ENCLOSING formation.
 *
 * The wedge is two triangles ``topCorner → conv → apex`` and ``baseCorner → conv → apex``
 * where ``conv`` is the convergence point on the FACING column (the unit's top/base mapped
 * onto the facing, midpoint). These triangles touch ``col`` only at the corner VERTICES
 * (never along a column-vertical EDGE), so their traced faces carry no column vertical →
 * ``labelFaces`` stamps them from the ``flood`` label as a BAND (the ``units.length===0``
 * trick). The flood label is the facing enclosing formation at the unit's mid-elevation
 * (owner 8f — "fill the void with the dominant lithology between correlations").
 *
 * When BOTH sides of an interval terminate, the two wedges MEET at the 0.5 midpoint rather
 * than double-cover: the ``conv`` x is clamped to at most the gap midpoint, so a left wedge
 * fills [apex..0.5] and a right wedge fills [0.5..apex] — they abut on the midpoint seam.
 *
 * Parameters
 * ----------
 * colX, facingX : number
 *     The terminating column's x and the facing column's x (metres).
 * facing : ColumnGeom
 *     The facing column (its enclosing formation labels the wedge).
 * topElev, baseElev : number
 *     The terminating unit's own top / base elevation (the wedge corners).
 * apexX, apexElev : number
 *     The termination apex (shared with the lens/onlap closing).
 * skipSide : 'top' | 'base' | null
 *     For a 1-corr ONLAP the TIED side is closed by its own tie/band — the enclosing floods
 *     only the UNTIED side, so the tied-side wedge is skipped (emitting it double-covers the
 *     tied band, the Tie-12 SILT×ZAND / KLEI×SILT overlap). A 0-corr LENS passes ``null``
 *     (both sides enclosing → both wedges).
 * nextFloodId : () => string
 *     ``flood``-curve id allocator.
 * labels : Map<string, LensLabel>
 *     Shared label map — the wedge curves carry the facing enclosing formation.
 * out : InputCurve[]
 *     Curve accumulator.
 */
function emitFloodWedge(
  colX: number,
  facingX: number,
  facing: ColumnGeom,
  topElev: number,
  baseElev: number,
  apexX: number,
  apexElev: number,
  skipSide: 'top' | 'base' | null,
  nextFloodId: () => string,
  labels: Map<string, LensLabel>,
  out: InputCurve[],
  convToFacingX?: number,
): void {
  const midElev = (topElev + baseElev) / 2
  const label = facingMatrixLabel(facing, midElev)
  if (label === null) return
  // ``conv`` — the facing convergence point. For a LENS (both flanks) it sits at the gap
  // MIDPOINT so two opposing terminations MEET at 0.5 rather than double-cover, and the facing
  // column's own units/bands cover [0.5..facing]. For a SKIPPED-SIDE ONLAP (``convToFacingX``
  // set to the facing x, round-2 Target 3) the SINGLE untied wedge must span FULL width to the
  // facing column vertical — converging at the gap midpoint left a seam-mismatch HOLE (the
  // enclosing flood's seam base at 0.5 = the apex, but the wedge's mid-elevation conv did not
  // meet it, gap4/gap17 CS2 diamond holes). Riding the apex ELEVATION out to the facing column
  // closes the wedge flush against the facing vertical at the tie level (the emitLonePinch
  // full-span convergence).
  const convX = (colX + facingX) / 2
  // For a SKIPPED-SIDE ONLAP wedge (``convToFacingX`` used as a flag now) the conv sits at the
  // apex ELEVATION so the wedge flank closes DIRECTLY to the apex (topCorner→apex) with no
  // mid-elevation dogleg — the dogleg's conv→apex vertical edge T-junctioned the enclosing KLEI
  // face and left a sliver hole at the apex (CS2 gap4 diamond). At apex elevation the conv→apex
  // edge is degenerate (skipped), so the wedge is one clean triangle.
  const convY = convToFacingX !== undefined ? apexElev : midElev
  const conv: Point = { x: convX, y: convY }
  const apex: Point = { x: apexX, y: apexElev }
  const topCorner: Point = { x: colX, y: topElev }
  const baseCorner: Point = { x: colX, y: baseElev }
  const push = (points: Point[]): void => {
    const id = nextFloodId()
    labels.set(id, label)
    out.push({ id, kind: 'closing', points })
  }
  // Degenerate guard: a wedge flank whose endpoints snap to one grid cell has zero extent —
  // emitting it leaves a self-touching ring. Skip such a flank (the enclosing fill covers the
  // slot; matches emitLonePinch's ``floodFrom`` degenerate skip).
  const deg = (a: Point, b: Point): boolean => segmentDeg(a, b)
  // The shared conv→apex edge closes the wedge between the pinch face and the facing side. It
  // is emitted once (both flanks lean on it).
  let convApexEmitted = false
  const emitConvApex = (): void => {
    if (convApexEmitted) return
    if (!deg(conv, apex)) push([conv, apex])
    convApexEmitted = true
  }
  if (skipSide !== 'top' && !deg(topCorner, conv)) {
    push([topCorner, conv])
    emitConvApex()
  }
  if (skipSide !== 'base' && !deg(baseCorner, conv)) {
    push([baseCorner, conv])
    emitConvApex()
  }
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
  nextFloodId: () => string,
  out: InputCurve[],
): void {
  void facing
  // Which contact carries the effective tie decides the apex line. Prefer the direct/derived
  // flag; a unit tied on BOTH would be corr 2 (handled upstream), so exactly one side is tied
  // for a corr-1 unit reaching here. If neither flag is set (a derived-band onlap whose flag
  // lives elsewhere), default to the base (the common onlap-riding-the-band-below case).
  const f = flags[ui] ?? { top: false, base: false }
  const baseTied = f.base && !f.top ? true : f.top && !f.base ? false : true
  // ONLAP-ON-A-SLOPING-TIE (round-2 Target 3, design §4 trap). The apex must ride the ACTUAL
  // tie line at 0.5, NOT the unit's own horizontal contact. Round 1 used ``facingElevAt`` (the
  // facing unit spanning the tied elevation), which returns the unit's OWN elevation when the
  // facing presents a unit there — so a steeply-sloping tie (Tie-6: left −5.31 → right −3.88,
  // 1.43 m of dip) placed the SILT pinch face BELOW where the tie actually runs, and the flood
  // wedge above it overlapped the neighbouring KLEI band (24/48/16 cross-litho overlaps). Read
  // the tie's REAL facing endpoint from ``activeTies`` and interpolate at ``apexFrac`` so the
  // pinch tip sits ON the tie; the flood wedge (below) is then rebuilt against that SAME apex.
  const tiedElev = baseTied ? u.baseElev : u.topElev
  const tieSide: 'top' | 'base' = baseTied ? 'base' : 'top'
  const facingTiedElev = tieFacingElevAt(gapIndex, side, tiedElev, tieSide, activeTies, facingElevAt, facing)
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
  // FLOOD the vacated width past the onlap tip with the facing enclosing formation (the same
  // ``emitFloodWedge`` device as the lens). This closes the hole-class (Tie-4: the SILT onlaps'
  // vacated wedge had no closing line → 74 holes → 0). The TIED side is closed by its own tie
  // line (the ``onlap`` edge rides it), so its wedge is SKIPPED — flooding it double-covers the
  // tied band (the Tie-6/12/CS2 SILT×KLEI overlap). Now that the apex rides the ACTUAL tie at
  // 0.5 (``apexElev`` on the tie line), the single UNTIED-side wedge closes flush against the
  // tie with no overlap: for a base-tied onlap the UNTIED-side is the TOP (skip 'base'); for a
  // top-tied onlap the untied side is the BASE (skip 'top'). Round 1 skipped the wrong-shaped
  // wedge with a HORIZONTAL apex and measured worse; with the tie-riding apex the untied wedge
  // fills the vacancy hole-free (the conv on the tied side rides the tie's facing endpoint).
  const skip: 'top' | 'base' = baseTied ? 'base' : 'top'
  emitFloodWedge(colX, facingX, facing, u.topElev, u.baseElev, apexX, apexElev, skip, nextFloodId, lensLabels, out, facingX)
}

/**
 * The tie's FACING endpoint elevation for the tie that anchors this unit's tied contact —
 * the tie-line geometry the onlap apex must ride (round-2 Target 3). The tie touches this
 * column at ``tiedElev`` on ``tieSide``; its OTHER endpoint on the facing column is the
 * elevation the onlap apex interpolates toward. Searches ``activeTies`` for the tie in this
 * gap whose endpoint on ``side`` matches ``tiedElev`` on ``tieSide``. When none matches (a
 * DERIVED tie whose curve lives on a neighbouring unit, or a top-band-implicit tie), falls
 * back to ``facingFallback`` (the facing unit spanning the elevation) so the apex still rides
 * horizontally rather than diverging.
 */
function tieFacingElevAt(
  gapIndex: number,
  side: 'left' | 'right',
  tiedElev: number,
  tieSide: 'top' | 'base',
  activeTies: readonly ResolvedTie[],
  facingFallback: (facing: ColumnGeom, e: number) => number,
  facing: ColumnGeom,
): number {
  void tieSide
  for (const t of activeTies) {
    if (t.gapIndex !== gapIndex) continue
    const nearPt = side === 'left' ? t.left : t.right
    const farPt = side === 'left' ? t.right : t.left
    // Match on the shared-contact ELEVATION, not the tie's labelled side: a DERIVED base-tie
    // (from the unit below carrying a top-tie) shares this contact via that neighbour, whose
    // tie endpoint sits at the SAME elevation. The tie endpoint at ``tiedElev`` IS this unit's
    // anchor regardless of whether the tie is labelled the unit's own contact or the shared
    // neighbour's — they are one physical contact. (A second tie at the same elevation would be
    // an unusual duplicate; the first match wins, which is the correct shared anchor.)
    if (Math.abs(nearPt.y - tiedElev) > ELEV_EPS + 1e-3) continue
    return farPt.y
  }
  return facingFallback(facing, tiedElev)
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
