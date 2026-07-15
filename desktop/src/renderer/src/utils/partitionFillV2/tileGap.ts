/**
 * partitionFillV2/tileGap.ts — TWO-SIDED terminations-first interval tiler (design
 * partition-engine-v2.md §4 "Terminate-by-default", ruling 8c; the FINAL SHAPES fix path).
 *
 * The seam-based ``emitIntervals.tileInterval`` fills a two-sided interval by placing ONE
 * thickness-weighted vertical SEAM between the left and right matrix claims and never emits
 * a per-unit termination curve. A genuine matched-pair BAND face then merges DOWN through
 * the un-terminated 1-corr / 0-corr units into a full-width face — the ``1corr-not-onlap`` /
 * ``0corr-not-lens`` leaks the conformance gate flags (Tie-10 g0 SILT/ZAND full-width bands,
 * the mixed-bracket residual, the two-sided absent minorities).
 *
 * Ruling 8c: every unit terminates by its OWN effective corr, emitted FIRST:
 *   - 2 → BAND (already a matched-pair band member — excluded from the matrix set upstream);
 *   - 1 → ONLAP riding its tie, tip 0.5 (``emitSharedContactOnlap`` machinery, generalised
 *         to two-sided: the enclosing matrix on the untied side floods the wedge past the
 *         tip via ``chooseOnlapEnclosing``);
 *   - 0 → 8b-capped LENS around the unit (0.45 apex, own mid-elevation).
 * The enclosing matrix then floods the residue BOUNDED BY the emitted termination lines, so
 * the band never claims a terminating unit's slot.
 *
 * BRING-UP: this path is gated behind ``tileFlags.twoSidedTerminationsEnabled`` (default
 * OFF). It is developed + validated one section's shapes at a time; the old ``tileInterval``
 * stays the default until every section's shapes are correct, then the flag flips default-ON
 * and the seam path is deleted (the cut-over). See REWRITE_STATE.md §6.
 *
 * ``intersect.ts`` / ``seamAnchor.ts`` are UNTOUCHABLE (613-hole trap). This module only
 * emits curves; the arrangement core is unchanged.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { LENS_PINCH_FRACTION } from '../partitionFill'
import { effectiveCorrForSide, type EffectiveCorr } from './effectiveCorr'
import { type ResolvedTie } from './emitCurves'
import { emitLensClosing, extractEnclosedLenses, type IntervalUnit } from './emitIntervalLenses'
import { type LonePinchBracket } from './emitLonePinch'
import { type LensLabel } from './emitLenses'
import { emitSharedContactOnlap } from './emitSharedContactOnlap'
import { chooseOnlapEnclosing } from './emitTerminations'
import { facingMatrixLabel } from './facingMatrix'
import { type ColumnGeom } from './sectionGeom'
import { tileGapLone } from './tileLone'
import { carveMultiUnitMinority, MULTIUNIT_MINORITY_CARVE_ENABLED, MULTIUNIT_SUBSTRIP_ENABLED, tileMultiUnit } from './tileMultiUnit'
import { type InputCurve, type Point } from './types'

/** LONE-side terminations switch (session 5, §7 step-2). GATED OFF — measured negative.
 *  The per-unit lone-stack termination (each unit onlaps/lenses against the tied-band context)
 *  drops conformance 19→17 in the right DIRECTION but tiles NON-hole-free: flag-ON measured
 *  holes 0→457, overlaps 0→666 (Tie-6/CS1/CS2 regressed). The vacated wedges of stacked lone
 *  units do NOT compose into a partition by independent per-unit emission — the same class of
 *  defect as the session-4 multi-unit sub-strip: a lone stack needs a SINGLE coherent flood
 *  boundary (the enclosing matrix descending as ONE face bounded by every unit's pinch), not N
 *  independent ``emitLonePinch`` wedges that overlap/gap at their shared conv/apex edges. Kept
 *  behind the flag as the session-5 measured negative; ``tileLone.ts`` skeleton reused by
 *  session 6 (the single-coherent-flood construction). See REWRITE_STATE.md §8. */
const LONE_TERMINATION_ENABLED = false

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6
/** Fraction epsilon — a seam this close to a column vertical is a no-op. */
const FRAC_EPS = 1e-9

/**
 * THROWAWAY diagnostic counters (bail reasons) — read by the tileGap probe to see why the
 * two-sided path did / did not fire per interval. Not part of the emission contract; the
 * orchestrator removes this block at cut-over. Deterministic (plain counters).
 */
export const TILEGAP_DIAG: Record<string, number> = {}
function diagBump(reason: string): void {
  TILEGAP_DIAG[reason] = (TILEGAP_DIAG[reason] ?? 0) + 1
}
export function tileGapDiagReset(): void {
  for (const k of Object.keys(TILEGAP_DIAG)) delete TILEGAP_DIAG[k]
  TILEGAP_CAPTURE.length = 0
}
/** THROWAWAY multi-unit interval structure capture (session-4 probe only). */
export const TILEGAP_CAPTURE: Record<string, unknown>[] = []
/** THROWAWAY rounding for the capture. */
function round3(x: number): number {
  return Math.round(x * 1000) / 1000
}

/** One matrix unit paired with its per-gap effective corr (2/1/0) on its own side. */
export interface CorrUnit {
  iu: IntervalUnit
  corr: EffectiveCorr
  /** Unit index on the owning column (to key the effective-corr lookup). */
  colUnitIndex: number
}

/**
 * The context one two-sided interval hands to the terminations-first tiler — the same shape
 * ``tileInterval`` receives, plus the per-gap effective-corr arrays for both columns (looked
 * up once per gap by the caller) and the gap index.
 */
export interface TileGapContext {
  gapIndex: number
  left: ColumnGeom
  right: ColumnGeom
  top: LonePinchBracket
  base: LonePinchBracket
  leftMatrix: IntervalUnit[]
  rightMatrix: IntervalUnit[]
  leftLenses: IntervalUnit[]
  rightLenses: IntervalUnit[]
  /** Per-unit effective corr for the LEFT column into this gap (index = column unit index). */
  leftCorr: readonly EffectiveCorr[]
  /** Per-unit effective corr for the RIGHT column into this gap. */
  rightCorr: readonly EffectiveCorr[]
  /** Formations carrying a matched-pair band in this gap (ruling 8e "one body" test). */
  bandFormations: ReadonlySet<string>
}

/**
 * Map a side's interval matrix units back to their owning-column unit index so each carries
 * its per-gap effective corr. An interval unit's span is a clamp of its column unit's span,
 * so the match is the column unit whose [baseElev..topElev] contains the interval unit's
 * mid-elevation.
 */
function withCorr(
  matrix: readonly IntervalUnit[],
  col: ColumnGeom,
  corr: readonly EffectiveCorr[],
): CorrUnit[] {
  const out: CorrUnit[] = []
  for (const iu of matrix) {
    const mid = (iu.topElev + iu.baseElev) / 2
    let idx = -1
    for (let ui = 0; ui < col.units.length; ui++) {
      const u = col.units[ui]
      if (u.topElev >= mid - ELEV_EPS && mid >= u.baseElev - ELEV_EPS && u.layerId === iu.unit.layerId) {
        idx = ui
        break
      }
    }
    if (idx < 0) {
      // Fall back to a layerId match (a clamp that shifted the mid outside the unit span).
      for (let ui = 0; ui < col.units.length; ui++) {
        if (col.units[ui].layerId === iu.unit.layerId) {
          idx = ui
          break
        }
      }
    }
    out.push({ iu, corr: corr[idx] ?? { topTied: false, baseTied: false, corr: 0 }, colUnitIndex: idx })
  }
  return out
}

/**
 * Whether a side's matrix reduces to a single lithology (all units share one formation). A
 * single-formation matrix floods the interval full-width behind the facing side's
 * terminations; a multi-formation matrix keeps its own internal ordering (handled by the
 * fall-through to the seam tiler for now — the multi-unit interbedded two-sided case is the
 * documented residual, ruling 7).
 */
function singleFormation(units: readonly CorrUnit[]): string | null {
  if (units.length === 0) return null
  const f0 = units[0].iu.unit.formationId
  for (const u of units) if (u.iu.unit.formationId !== f0) return null
  return f0
}

/**
 * Emit the two-sided terminations-first curves for one interval, OR return ``false`` to fall
 * back to the seam tiler for a shape this increment does not yet cover (ruling 7 — a partial
 * emit that would gap/overlap is refused; the caller keeps the old path for it).
 *
 * COVERED THIS INCREMENT (Tie-10 g0 class — the smallest two-sided violation set):
 *   - each side is a SINGLE matrix unit (post enclosed-lens extraction), of DIFFERENT
 *     formations, each terminating by its own corr (1 → onlap, 0 → lens), the facing side's
 *     formation flooding the vacated wedge.
 * NOT YET COVERED (falls back): multi-unit matrix on either side (interbedded two-sided
 * stacks), same-formation single-single (the existing geometric-band path handles it).
 *
 * Parameters
 * ----------
 * ctx : TileGapContext
 *     The interval columns, brackets, per-side matrix / lens units, and per-gap corr arrays.
 * nextId : () => string
 *     ``close`` / ``onlap`` curve id allocator.
 * nextFloodId : () => string
 *     ``flood`` curve id allocator (``labelFaces`` stamps a flood-bounded wedge BAND).
 * lensLabels : Map<string, LensLabel>
 *     Shared label map (pinch = own formation; flood = enclosing matrix).
 * out : InputCurve[]
 *     Curve accumulator.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the terminations-first path emitted the interval (caller skips the seam
 *     tiler); ``false`` to fall back.
 */
export function tileGapTwoSided(
  ctx: TileGapContext,
  nextId: () => string,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): boolean {
  const { left, right, top, base, leftMatrix, rightMatrix, leftLenses, rightLenses, leftCorr, rightCorr } = ctx
  const leftUnitsAll = withCorr(leftMatrix, left, leftCorr)
  const rightUnitsAll = withCorr(rightMatrix, right, rightCorr)
  TILEGAP_CAPTURE.push({
    gap: ctx.gapIndex,
    top: { l: round3(top.leftElev), r: round3(top.rightElev), anchor: top.anchor },
    base: { l: round3(base.leftElev), r: round3(base.rightElev), anchor: base.anchor },
    left: leftUnitsAll.map((u) => ({ f: u.iu.unit.formationId, corr: u.corr.corr, t: u.corr.topTied, b: u.corr.baseTied, top: round3(u.iu.topElev), base: round3(u.iu.baseElev) })),
    right: rightUnitsAll.map((u) => ({ f: u.iu.unit.formationId, corr: u.corr.corr, t: u.corr.topTied, b: u.corr.baseTied, top: round3(u.iu.topElev), base: round3(u.iu.baseElev) })),
    llens: leftLenses.map((u) => u.unit.formationId),
    rlens: rightLenses.map((u) => u.unit.formationId),
  })
  // LONE side (one matrix empty because the facing units are all TIED / BANDED). Ruling 8f: the
  // excluded facing tied units are BRACKET CONTEXT — terminate each lone unit against them so a
  // same-formation flood never merges with the facing band full-width (the §7 ZAND-full-width
  // ROOT). ``tileGapLone`` owns the interval on success; on ``false`` it falls to
  // ``routeLoneSidePinch`` / the seam (the caller, since we return false here).
  if (leftMatrix.length === 0 || rightMatrix.length === 0) {
    if (LONE_TERMINATION_ENABLED) {
      const loneSide: 'left' | 'right' = leftMatrix.length > 0 ? 'left' : 'right'
      const loneUnits = loneSide === 'left' ? leftUnitsAll : rightUnitsAll
      const loneLenses = loneSide === 'left' ? leftLenses : rightLenses
      const handled = tileGapLone(ctx, loneSide, loneUnits, loneLenses, nextId, nextFloodId, lensLabels, out)
      if (handled) {
        diagBump('lone-fired')
        return true
      }
    }
    diagBump('lone')
    return false
  }

  const leftUnits = leftUnitsAll
  const rightUnits = rightUnitsAll

  // SINGLE-SINGLE different-formation (the smallest two-sided shape): each side one unit, of
  // different formations, terminating by its own corr with the facing formation flooding. On
  // real data ZERO intervals match this (every offender is multi-unit — see REWRITE_STATE §5),
  // so it is kept as the proven-correct base case; the multi-unit path below is the real work.
  if (leftUnits.length === 1 && rightUnits.length === 1) {
    const lf = singleFormation(leftUnits)
    const rf = singleFormation(rightUnits)
    if (lf !== null && rf !== null && lf === rf) {
      // SAME-FORMATION single-single. Ruling 8e: enclosed by its OWN formation's matched-pair
      // band → ONE body, keep the geometric merge (return false). Ruling 8 (retired auto-match):
      // NO band of that formation in the gap → two untied/onlapping same-formation units are
      // OPPOSING TERMINATIONS, not one band — split them (the Tie-10 g0 ZAND full-width leak).
      if (ctx.bandFormations.has(lf)) {
        diagBump('sameFormation-8e')
        return false // one body — the geometric-band path owns it.
      }
      const handled = tileSameFormationTwoSided(ctx, leftUnits[0], rightUnits[0], nextId, nextFloodId, lensLabels, out)
      if (handled) {
        diagBump('sameFormation-fired')
        return true
      }
      diagBump('sameFormation-bail')
      return false
    }
    return tileSingleSingle(ctx, leftUnits[0], rightUnits[0], nextId, nextFloodId, lensLabels, out)
  }

  // MULTI-UNIT two-sided interval (the Tie-10 g0 class — the core ruling-8c residual): a stack
  // facing a stack. SUB-STRIP DECOMPOSITION (design §4 "Terminate-by-default", session-4 §6
  // step 1a): split [top,base] in FRACTION space at the union of BOTH sides' internal contact
  // fractions; each sub-strip presents exactly ONE left + ONE right formation → a single-single
  // cell routed through the proven ``tileSingleSingle`` termination machinery. All-or-nothing
  // buffering (ruling 7): only merge into ``out``/``lensLabels`` when EVERY sub-strip terminates
  // hole-free, else bail the whole interval to the seam tiler (no partial emit).
  if (MULTIUNIT_SUBSTRIP_ENABLED) {
    const handled = tileMultiUnit(ctx, leftUnits, rightUnits, nextId, nextFloodId, lensLabels, out)
    if (handled) {
      diagBump('multiunit-fired')
      return true
    }
  }
  // §7 step-1: carve the enclosed MIXED-BRACKET minorities as own-elevation lenses (the seam
  // swallows them → ABSENT), then let the interval fall through to the seam tiler for the rest.
  // Additive to ``out`` + return false (the seam re-tiles the non-minority units). Measured
  // hole/overlap-free (session-5 harness); a mixed-bracket notch the arrangement fails to
  // separate would surface as a different-litho overlap and revert the flag.
  if (MULTIUNIT_MINORITY_CARVE_ENABLED) {
    carveMultiUnitMinority(ctx, leftUnits, rightUnits, nextId, nextFloodId, lensLabels, out)
  }
  diagBump(`multiunit-L${leftUnits.length}-R${rightUnits.length}`)
  return false
}

/**
 * Emit the single-single different-formation two-sided termination: each unit terminates by
 * its own corr (1 → onlap, 0 → lens), the facing formation flooding the vacated wedge.
 */
function tileSingleSingle(
  ctx: TileGapContext,
  lu: CorrUnit,
  ru: CorrUnit,
  nextId: () => string,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): boolean {
  const { left, right, top, base, leftLenses, rightLenses } = ctx
  const midElevL = (lu.iu.topElev + lu.iu.baseElev) / 2
  const midElevR = (ru.iu.topElev + ru.iu.baseElev) / 2
  const facingForLeft = facingMatrixLabel(right, midElevL)
  const facingForRight = facingMatrixLabel(left, midElevR)
  if (facingForLeft === null || facingForRight === null) return false

  // Buffer into a LOCAL accumulator + a local label patch, merged into ``out`` / ``lensLabels``
  // only on FULL success — a partial emit (okL pushed, okR bailed) then the caller's seam-tiler
  // fallback would DOUBLE-COVER the interval. Ruling 7: all-or-nothing per interval.
  const buf: InputCurve[] = []
  const labelPatch = new Map<string, LensLabel>()
  const okL = emitSideTermination(lu, 'left', left.x, right.x, top, base, facingForLeft, nextId, nextFloodId, labelPatch, buf)
  const okR = emitSideTermination(ru, 'right', right.x, left.x, top, base, facingForRight, nextId, nextFloodId, labelPatch, buf)
  if (!okL || !okR) {
    diagBump('termbail')
    return false
  }
  // Enclosed lenses on either side keep their own 0.45 apex (their matrix band is the flood).
  for (const u of leftLenses) emitLensClosing(u, left.x, right.x, LENS_PINCH_FRACTION, nextId, buf)
  for (const u of rightLenses) emitLensClosing(u, right.x, left.x, LENS_PINCH_FRACTION, nextId, buf)
  for (const [k, v] of labelPatch) lensLabels.set(k, v)
  out.push(...buf)
  diagBump('fired')
  return true
}

/**
 * Emit a SAME-FORMATION single-single two-sided termination (ruling 8, retired auto-match): two
 * same-formation units facing each other with NO matched-pair band of that formation are OPPOSING
 * terminations, not one band. Each terminates by its own corr; because the FACING unit is the same
 * formation (so flooding it re-merges — the wall), the enclosing that floods each unit's vacated
 * wedge is the unit's OWN-COLUMN bracket neighbour (the differing lithology above / below the
 * interval on its own column), never the facing same-formation unit.
 *
 * Returns ``false`` when either side cannot terminate hole-free (no differing own-column enclosing,
 * or the unit does not fill its interval side) — the caller then keeps the geometric merge.
 */
function tileSameFormationTwoSided(
  ctx: TileGapContext,
  lu: CorrUnit,
  ru: CorrUnit,
  nextId: () => string,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): boolean {
  const { left, right, top, base, leftLenses, rightLenses } = ctx
  // The enclosing on each side is the OWN column's lithology just ABOVE the interval top and
  // just BELOW the interval base (the bracket neighbours). ``chooseOnlapEnclosing`` then picks
  // whichever differs from the unit's own formation to flood the notch (never the same formation).
  const ownEnclosing = (col: ColumnGeom, iTop: number, iBase: number): { above: LensLabel | null; below: LensLabel | null } => ({
    above: facingMatrixLabel(col, iTop + 0.02),
    below: facingMatrixLabel(col, iBase - 0.02),
  })
  const lEnc = ownEnclosing(left, top.leftElev, base.leftElev)
  const rEnc = ownEnclosing(right, top.rightElev, base.rightElev)
  const buf: InputCurve[] = []
  const labelPatch = new Map<string, LensLabel>()
  const okL = emitSameFormSide(lu, 'left', left.x, right.x, top, base, lEnc.above, lEnc.below, nextId, nextFloodId, labelPatch, buf)
  const okR = emitSameFormSide(ru, 'right', right.x, left.x, top, base, rEnc.above, rEnc.below, nextId, nextFloodId, labelPatch, buf)
  if (!okL || !okR) return false
  for (const u of leftLenses) emitLensClosing(u, left.x, right.x, LENS_PINCH_FRACTION, nextId, buf)
  for (const u of rightLenses) emitLensClosing(u, right.x, left.x, LENS_PINCH_FRACTION, nextId, buf)
  for (const [k, v] of labelPatch) lensLabels.set(k, v)
  out.push(...buf)
  return true
}

/**
 * One side of a same-formation two-sided termination. Onlap (1-corr) rides its tie with the
 * DIFFERING own-column bracket neighbour flooding the vacated wedge (``chooseOnlapEnclosing``);
 * lens (0-corr) pinches to 0.45 with the differing neighbour flooding. Returns ``false`` when the
 * unit does not fill its interval side or no differing own-column enclosing exists.
 */
function emitSameFormSide(
  cu: CorrUnit,
  side: 'left' | 'right',
  loneX: number,
  facingX: number,
  top: LonePinchBracket,
  base: LonePinchBracket,
  aboveEnc: LensLabel | null,
  belowEnc: LensLabel | null,
  nextId: () => string,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): boolean {
  const { iu, corr } = cu
  const iTop = side === 'left' ? top.leftElev : top.rightElev
  const iBase = side === 'left' ? base.leftElev : base.rightElev
  if (Math.abs(iu.topElev - iTop) > 0.02 || Math.abs(iu.baseElev - iBase) > 0.02) return false
  // A differing enclosing must exist on at least the flooding side (else the notch re-merges).
  const own = iu.unit.formationId
  const aboveDiff = aboveEnc !== null && aboveEnc.formationId !== own
  const belowDiff = belowEnc !== null && belowEnc.formationId !== own
  if (corr.corr === 1) {
    const baseTied = corr.baseTied && !corr.topTied
    // Base-tied onlap laps the band below → the ABOVE neighbour floods; top-tied → the BELOW.
    const flood = baseTied ? aboveEnc : belowEnc
    if (flood === null || flood.formationId === own) return false
    // ``chooseOnlapEnclosing`` picks the differing neighbour (here already the differing one).
    const enclosing = chooseOnlapEnclosing(own, baseTied, aboveEnc ?? flood, belowEnc ?? flood)
    if (enclosing.formationId === own) return false
    emitSharedContactOnlap(iu, side, loneX, facingX, top, base, baseTied, enclosing, nextId, nextFloodId, lensLabels, out)
    return true
  }
  if (corr.corr === 0) {
    if (!aboveDiff && !belowDiff) return false
    // 0-corr lens with a mixed / differing own-column enclosing flooding both wedges. Reuse the
    // interior lens closing + a flood band vertical labelled with the differing neighbour.
    emitLensClosing(iu, loneX, facingX, LENS_PINCH_FRACTION, nextId, out)
    const floodId = nextFloodId()
    lensLabels.set(floodId, (aboveDiff ? aboveEnc : belowEnc) as LensLabel)
    const facingTopElev = side === 'left' ? top.rightElev : top.leftElev
    const facingBaseElev = side === 'left' ? base.rightElev : base.leftElev
    out.push({ id: floodId, kind: 'closing', points: [{ x: facingX, y: facingTopElev }, { x: facingX, y: facingBaseElev }] as Point[] })
    return true
  }
  return false
}

/**
 * Emit one side's single-unit termination into the two-sided interval (onlap for 1-corr,
 * lens for 0-corr), the facing formation flooding the vacated wedge. Returns ``false`` for a
 * shape it cannot terminate hole-free (the caller then bails the whole interval to the seam
 * tiler — no partial emit, ruling 7).
 */
export function emitSideTermination(
  cu: CorrUnit,
  side: 'left' | 'right',
  loneX: number,
  facingX: number,
  top: LonePinchBracket,
  base: LonePinchBracket,
  facingMatrix: LensLabel,
  nextId: () => string,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): boolean {
  const { iu, corr } = cu
  // The unit must fill the interval on its own side for a clean single-unit termination — a
  // strip left above/below it would be an uncovered hole (bail to the seam tiler).
  const iTop = side === 'left' ? top.leftElev : top.rightElev
  const iBase = side === 'left' ? base.leftElev : base.rightElev
  if (Math.abs(iu.topElev - iTop) > 0.02 || Math.abs(iu.baseElev - iBase) > 0.02) return false

  if (corr.corr === 1) {
    // ONLAP riding its tied contact. The enclosing matrix on the untied side floods the wedge;
    // here BOTH bracket enclosings are the facing formation (a real neighbour band), so
    // ``chooseOnlapEnclosing`` returns the facing formation regardless of which contact is tied.
    const baseTied = corr.baseTied && !corr.topTied
    const enclosing = chooseOnlapEnclosing(iu.unit.formationId, baseTied, facingMatrix, facingMatrix)
    emitSharedContactOnlap(iu, side, loneX, facingX, top, base, baseTied, enclosing, nextId, nextFloodId, lensLabels, out)
    return true
  }
  if (corr.corr === 0) {
    // 0-corr LENS: the unit pinches to a 0.45 own-elevation apex; the facing formation floods
    // the wedge past the apex. Emit the lens closing + a facing-matrix flood band spanning the
    // interval so the vacated width is a BAND face (the ``emitBottomTieSubstrate`` label trick).
    emitLensClosing(iu, loneX, facingX, LENS_PINCH_FRACTION, nextId, out)
    const floodId = nextFloodId()
    lensLabels.set(floodId, facingMatrix)
    // The flood band is the interval quad on the facing side of the apex — a straight vertical
    // on the facing column plus the two bracket lines. The facing column vertical already exists
    // (it is a real column edge); emit the facing bracket-to-bracket verticals as a flood curve
    // so the wedge face reads BAND from the facing-matrix label.
    const facingTopElev = side === 'left' ? top.rightElev : top.leftElev
    const facingBaseElev = side === 'left' ? base.rightElev : base.leftElev
    out.push({
      id: floodId,
      kind: 'closing',
      points: [
        { x: facingX, y: facingTopElev },
        { x: facingX, y: facingBaseElev },
      ] as Point[],
    })
    return true
  }
  // corr 2 should not reach here (band members are excluded upstream); refuse defensively.
  return false
}

/** Re-exported for the caller's meet-fraction fallback checks. */
export { FRAC_EPS }
