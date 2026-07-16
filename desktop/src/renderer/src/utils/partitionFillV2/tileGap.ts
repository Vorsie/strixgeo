/**
 * partitionFillV2/tileGap.ts — the TWO-SIDED terminations-first entry point (design
 * partition-engine-v2.md §8 ruling 8g — the owner's boundary-walk algorithm; the FLIP).
 *
 * SESSION 7 (the flip): the seam-based ``emitIntervals.tileInterval`` fills a two-sided
 * interval by placing ONE thickness-weighted vertical SEAM and never emits a per-unit
 * termination curve, so a matched-pair BAND face merges DOWN through the un-terminated
 * 1-corr / 0-corr units into a full-width face — the ``1corr-not-onlap`` / ``0corr-not-lens``
 * leaks. Ruling 8g replaces the whole bail taxonomy (lone / single-single / same-formation /
 * multi-unit) with ONE path: every unit terminates by its own effective corr (0 → 8b lens,
 * 1 → onlap riding its tie, 2 → carried by its band, excluded upstream) toward a shared 0.5
 * seam, and the enclosing formation floods each residue by boundary composition — a lens is a
 * DETOUR in the enclosing band's contour, never a wall. That single construction is
 * ``tileCoherentStack`` (the generalised session-6 meet-at-seam primitive).
 *
 * ``tileGapTwoSided`` is now a thin adapter: map each side's interval matrix units to their
 * per-gap effective corr, then hand the whole interval to ``tileCoherentStack``. It returns
 * ``false`` only for a shape the coherent tiler genuinely cannot span hole-free (during
 * bring-up such an interval keeps the old seam via the caller's fall-through).
 *
 * BRING-UP: gated behind ``tileFlags.twoSidedTerminationsEnabled`` (default OFF). The old
 * ``tileInterval`` seam stays the default until the owner dogfeds the flag ON, then it is
 * deleted (the cut-over). ``intersect.ts`` / ``seamAnchor.ts`` UNTOUCHABLE (613-hole trap).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type EffectiveCorr } from './effectiveCorr'
import { type IntervalUnit } from './emitIntervalLenses'
import { type LonePinchBracket } from './emitLonePinch'
import { type LensLabel } from './emitLenses'
import { type ColumnGeom } from './sectionGeom'
import { tileCoherentStack } from './tileCoherentStack'
import { type InputCurve } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/**
 * THROWAWAY diagnostic counters (fired / bail reasons) — read by the shape-audit harness to
 * see whether the coherent path owned each interval. Not part of the emission contract; the
 * orchestrator strips this block at cut-over. Deterministic (plain counters).
 */
export const TILEGAP_DIAG: Record<string, number> = {}
function diagBump(reason: string): void {
  TILEGAP_DIAG[reason] = (TILEGAP_DIAG[reason] ?? 0) + 1
}
export function tileGapDiagReset(): void {
  for (const k of Object.keys(TILEGAP_DIAG)) delete TILEGAP_DIAG[k]
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
  /** Formations carrying a matched-pair band in this gap (ruling 8g(b) "one body" test). */
  bandFormations: ReadonlySet<string>
}

/**
 * Map a side's interval matrix units back to their owning-column unit index so each carries
 * its per-gap effective corr. An interval unit's span is a clamp of its column unit's span,
 * so the match is the column unit whose [baseElev..topElev] contains the interval unit's
 * mid-elevation.
 */
export function withCorr(
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
 * Emit the two-sided terminations-first curves for one interval via the coherent stack tiler
 * (ruling 8g), OR return ``false`` for a shape it cannot span hole-free (a non-contiguous
 * stack / no enclosing to close a residue) — the caller then keeps the old seam for it during
 * bring-up (ruling 7 — no partial emit; ``tileCoherentStack`` buffers all-or-nothing).
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
 *     ``true`` when the coherent path emitted the interval (caller skips the seam tiler);
 *     ``false`` to fall back.
 */
export function tileGapTwoSided(
  ctx: TileGapContext,
  nextId: () => string,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): boolean {
  const { left, right, top, base, leftMatrix, rightMatrix, leftLenses, rightLenses, leftCorr, rightCorr } = ctx
  const leftUnits = withCorr(leftMatrix, left, leftCorr)
  const rightUnits = withCorr(rightMatrix, right, rightCorr)

  // THE FLIP (session 7, ruling 8g): every interval routes through the ONE coherent stack
  // tiler — 0-corr lenses + 1-corr onlaps emitted per unit toward a shared 0.5 seam, the
  // enclosing formation flooding each residue by boundary composition (a lens is a DETOUR,
  // never a wall). No bail taxonomy: the lone case is a stack with one side empty; the
  // multi-unit case is the same slab decomposition. ``bandFormations`` = ruling 8g(b)
  // one-body test (base-tied same-formation pairs are excluded upstream as band members, so
  // they never reach here). Returns false ONLY for a shape it cannot span hole-free.
  const handled = tileCoherentStack(
    leftUnits, rightUnits, leftLenses, rightLenses, left, right, top, base,
    ctx.bandFormations, nextId, nextFloodId, lensLabels, out,
  )
  if (handled) diagBump('coherent-stack-fired')
  else diagBump(`coherent-bail-L${leftUnits.length}-R${rightUnits.length}`)
  return handled
}
