/**
 * partitionFillV2/emitTerminationSweep.ts — THE HOIST: the ONE unconditional termination
 * pass, restructured to owner rulings 8i / 8j / 8k (design partition-engine-v2.md §8). This
 * file is the CLASSIFY + ITERATE half; the DRAW half lives in ``drawTermination.ts``.
 *
 * RULING 8k (COLUMNS ARE GROUND TRUTH, 2026-07-17): the primary loop is COLUMN-first — for each
 * column, for each picked unit, ask leftSide/rightSide (its two adjacent gaps) and draw. The gap
 * is only the look-direction, never the owner of the iteration (which was the recorded root of
 * the gap-frame double-emit / run-bails). RULING 8j (MERGE AFTER FILL): no termination is
 * suppressed by a predicted merge — a corr-1 side ALWAYS onlaps (``drawTermination`` deletes
 * ``mergesSameFormationBand``); same-litho touching regions merge post-fill
 * (``mergeTouchingBodies`` in ``computeSectionFillV2``).
 *
 * THE PROBLEM THE HOIST SOLVES (owner, verbatim): "there is something fundamentally wrong. If
 * my 2/1/0 rule is hardcoded these wouldn't have happened." Classification (``effectiveCorr``)
 * is single-source and correct; EMISSION was not — lenses / onlaps were emitted by whichever
 * interval tiler owned the space, and every tiler carried guards that could SUPPRESS a
 * termination. THE HOIST makes emission UNCONDITIONAL and deletes that failure class.
 *
 * RULING 8i restructure (session 16). The owner dictated three functions:
 *   - ``leftSide`` / ``rightSide`` — CLASSIFY a side by its correlation-band count
 *     (0 lens / 1 onlap / 2 band). This IS ``effectiveCorrForSide`` (``effectiveCorr.ts``) —
 *     the single 2/1/0 source, already shared with the conformance gate. The sweep does NOT
 *     re-implement it; it calls it (the classify half).
 *   - ``drawTermination`` (``drawTermination.ts``) — the DRAW half. 0 → lens ALWAYS (only
 *     physical suppressions); 1 → FOLLOW the tie to the facing unit on the matched side
 *     (below-for-top-tie / above-for-bottom-tie), same litho → do nothing (merge), different →
 *     onlap; 2 → nothing (band line art). This DISSOLVES the old run-existence
 *     ``ruledMergeExempt`` heuristic (which merged on a same-formation band existing anywhere in
 *     the gap, not on the unit's actual tie) and the 11-row mismatched-facing ABSENT class.
 *
 * The sweep still owns the RULE-DERIVED / PHYSICAL suppressions that are NOT per-unit draw
 * decisions:
 *   - BRIDGE-ANCHOR — a unit a deep-to-deep bridge carries is 2-corr-like by bridge; the bridge
 *     provides its boundary (carving a lens into a bridge substrate band voids the substrate).
 *   - SUB-TD deferral — a unit entirely below the facing TD is ``emitSubTdLenses``' job (its
 *     M-in-M annulus + bridge guards are the safe sub-TD wall); the sweep defers so no double emit.
 *   - SUB-SNAP-WIDTH gap — two columns closer than ``SUB_SNAP_GAP_M`` cannot resolve a lateral
 *     pinch; the flood fills full-width (the session-10 physical rule generalised to the gap).
 *   - the MINORITY-vs-DOMINANT fill gate (owner 8f/8h) — a boundary/dominant matrix unit FLOODS
 *     rather than lenses (pinching a dominant matrix to 0.5 breaks its band → holes). This
 *     decides WHO holds the void, not whether a genuine minority terminates.
 *
 * FLAG. The sweep is the FLAG-ON engine (``twoSidedTerminationsEnabled``): flag OFF stays the
 * proven v1 seam baseline. Cut-over flips the flag default ON and deletes the seam path.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { collectGapBands } from './emitBands'
import { drawTermination } from './drawTermination'
import { type ResolvedTie } from './emitCurves'
import { effectiveCorrForSide, tiedFlags } from './effectiveCorr'
import { type LensLabel } from './emitLenses'
import { bridgeAnchorKey } from './emitSubstrate'
import { type ColumnGeom, type SectionInput } from './sectionGeom'
import { type InputCurve } from './types'

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
 * Emit every unit's termination (0 → lens, 1 → onlap-or-merge per ruling 8i) for every gap+side,
 * into the curve set. The enclosing flood (``emitEnclosingFlood``) fills full-width behind these
 * curves, so each termination carves a HOLE by construction (the arrangement decides containment;
 * the sweep never decides whether a termination fires — only the ruled/physical suppressions above).
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     The normalised section (columns carry elevations + x; edges are raw).
 * activeTies : readonly ResolvedTie[]
 *     Ties that survived crossing-conflict pruning (drive ``effectiveCorrForSide``).
 * bridgeAnchored : ReadonlySet<string>
 *     ``ci|ui|top`` / ``ci|ui|base`` contacts a deep-to-deep bridge carries — the bridge-anchor
 *     rule: such a unit is 2-corr-like and never terminates here.
 * lensLabels : Map<string, LensLabel>
 *     Shared label map — every emitted closing carries the unit's OWN litho.
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
  // A SEPARATE ``flood``-prefixed id space for the vacated-wedge closures.
  let fseq = 0
  const nextFloodId = (): string => `floodsw${fseq++}`
  // Per-gap matched-pair bands, computed once and reused by BOTH the left-look and the right-look
  // of the two columns bounding the gap (the gap is only the look-direction — ruling 8k).
  const bandsOfGap = new Map<number, ReturnType<typeof collectGapBands>>()
  const subSnap = (gi: number): boolean => columns[gi + 1].x - columns[gi].x < SUB_SNAP_GAP_M
  const gapBands = (gi: number): ReturnType<typeof collectGapBands> => {
    let b = bandsOfGap.get(gi)
    if (!b) {
      b = collectGapBands(gi, columns[gi], columns[gi + 1], activeTies)
      bandsOfGap.set(gi, b)
    }
    return b
  }
  // RULING 8k — COLUMNS ARE GROUND TRUTH (owner, 2026-07-17: "you're looking at gaps not at
  // columns; on the columns the user's picked lithos are ground truth"). The primary loop is
  // COLUMN-first: for each column, for each unit of the user's picked stack, ask leftSide /
  // rightSide (its two adjacent gaps) and draw. The GAP is only the direction a unit LOOKS —
  // never the owner of the iteration, never a context that reinterprets the stack. A column looks
  // RIGHT into gap ``ci`` (it is that gap's LEFT column) and LEFT into gap ``ci-1`` (that gap's
  // RIGHT column). Per-side math is unchanged (``emitSideSweep``); only the loop nesting flips
  // from gap-first to column-first — a behaviour-preserving refactor (ids/geometry order-invariant
  // for labelling + the arrangement). The SUB-SNAP-WIDTH guard stays per look-gap.
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci]
    // Look RIGHT into gap ci (this column is the gap's LEFT column, side 'left').
    if (ci + 1 < columns.length && !subSnap(ci)) {
      emitSideSweep(ci, 'left', ci, col, columns[ci + 1], gapBands(ci), activeTies, bridgeAnchored, lensLabels, nextId, nextFloodId, out)
    }
    // Look LEFT into gap ci-1 (this column is the gap's RIGHT column, side 'right').
    if (ci - 1 >= 0 && !subSnap(ci - 1)) {
      emitSideSweep(ci - 1, 'right', ci, col, columns[ci - 1], gapBands(ci - 1), activeTies, bridgeAnchored, lensLabels, nextId, nextFloodId, out)
    }
  }
}

/**
 * Emit the terminations for ONE side of ONE gap. ``col`` is the near column whose units terminate
 * toward ``facing``; ``colIndex`` is its column index (for the bridge-anchor lookup); ``side``
 * names which facing column ``col`` is for this gap.
 *
 * The CLASSIFY half (ruling 8i ``leftSide``/``rightSide``) is ``effectiveCorrForSide`` — the
 * single 2/1/0 source. The DRAW half is ``drawTermination``. This function is the iterate glue +
 * the ruled/physical suppressions (bridge / sub-TD / minority gate).
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
  // RULING 8i CLASSIFY: effectiveCorrForSide is the SINGLE 2/1/0 source (leftSide/rightSide),
  // shared with the conformance gate. It folds direct + derived + band-member + top-band ties —
  // but NOT the bridge-anchor extension, so we consult ``bridgeAnchored`` explicitly below.
  const corr = effectiveCorrForSide(gapIndex, side, col, facing, left, right, activeTies)
  // Direct/derived-base tie flags (``tiedFlags``) — used by ``drawTermination`` for the ONLAP SIDE
  // (which contact the tip rides / which way the flood wedge fills), distinct from the effective
  // 2/1/0 corr (which folds ruling-8a derived BAND ties too). A lone-stack unit tied only by a
  // derived band must still flood away from its neighbour, which the direct-flag default picks.
  const flags = tiedFlags(gapIndex, side, col.units.length, activeTies)
  const colX = col.x
  const facingX = facing.x

  const isBridged = (ui: number): boolean =>
    bridgeAnchored.has(bridgeAnchorKey(colIndex, ui, 'top')) ||
    bridgeAnchored.has(bridgeAnchorKey(colIndex, ui, 'base'))
  // The facing column's TD: a unit entirely below it is a SUB-TD minority owned by
  // ``emitSubTdLenses`` — the sweep DEFERS so a lens is never double-emitted.
  let facingTD = Infinity
  for (const fu of facing.units) if (fu.baseElev < facingTD) facingTD = fu.baseElev

  for (let ui = 0; ui < col.units.length; ui++) {
    const eff = corr[ui] ?? { topTied: false, baseTied: false, corr: 0 as const }
    const c = eff.corr
    if (c === 2) continue // band member / first-unit band — given line art (bandc), no termination
    // BRIDGE-ANCHOR rule: a bridge-carried unit is a substrate band anchor (2-corr-like) — the
    // bridge already provides its boundary; carving a lens voids the substrate face.
    if (isBridged(ui)) continue
    // Sub-TD deferral: a unit entirely below the facing TD is ``emitSubTdLenses``' job.
    if (col.units[ui].topElev <= facingTD - ELEV_EPS) continue
    const u = col.units[ui]

    if (c === 0 && !isMinorityWide(col, ui)) {
      // MINORITY-vs-DOMINANT fill gate (owner 8f/8h): a 0-corr unit lenses iff it is a genuine
      // interior minority (both own-column neighbours a DIFFERENT formation, so the enclosing
      // floods around it). A boundary / dominant matrix unit FLOODS instead — pinching it to 0.5
      // breaks its band → holes (the measured +59-hole regression of firing the lens for every
      // 0-corr unit). This is the STRUCTURAL fill rule (who holds the void), NOT a ruling-8i draw
      // decision — ruling 8i's "0 → lens always" applies once a unit IS the minority.
      continue
    }

    // RULING 8i DRAW: 0 → lens always (physical suppressions only); 1 → follow the tie
    // (same litho on the matched facing side → merge; different → onlap); 2 → handled above.
    const df = flags[ui] ?? { top: false, base: false }
    drawTermination(
      u,
      c,
      eff.topTied,
      eff.baseTied,
      df.top,
      df.base,
      side,
      colX,
      facingX,
      gapIndex,
      facing,
      bands,
      activeTies,
      lensLabels,
      nextId,
      nextFloodId,
      out,
    )
  }
}

/**
 * The WIDENED minority test (round-2 Target 2): an INTERIOR unit is a minority whenever BOTH its
 * immediate neighbours are a DIFFERENT formation from it. This is the round-1 same-formation
 * enclosure (above === below ≠ self) PLUS the MIXED-bracket case (above ≠ below, both ≠ self): a
 * mixed-bracket interior minority (KLEI above, SILT below, VEEN self — the Tie-6/9/11 VEEN class)
 * still lenses. Boundary units (ui 0 / last) stay EXCLUDED: they touch surface / TD and are the
 * dominant flooding matrix, never a lens.
 */
function isMinorityWide(col: ColumnGeom, ui: number): boolean {
  if (ui <= 0 || ui + 1 >= col.units.length) return false
  const above = col.units[ui - 1]
  const below = col.units[ui + 1]
  const self = col.units[ui]
  return above.formationId !== self.formationId && below.formationId !== self.formationId
}
