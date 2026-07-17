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
import { emitBoundaryLens, emitSurfaceOnlapFlank } from './emitBoundaryLens'
import { type ResolvedTie } from './emitCurves'
import { effectiveCorrForSide, tiedFlags } from './effectiveCorr'
import { type LensLabel } from './emitLenses'
import { type ColumnGeom, type SectionInput } from './sectionGeom'
import { type InputCurve } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

// RULING 8i(e) (owner, 2026-07-17 — "everything must lens, no narrow gap guard — make it so
// that all 0-corr bodies lens in first instance"): the SUB_SNAP_GAP_M policy threshold is
// DELETED. Every 0-corr side draws its lens regardless of gap width; the ONLY permissible
// collapse is the PHYSICAL 1 mm snap floor (``segmentDegenerate`` inside ``emitLensClosing`` /
// the ``oflank`` guard), which drops a single degenerate flank cleanly per instance (the
// enclosing flood covers that slot, holes/overlaps stay 0). The 0.17 m CS1 gap21 minorities
// now emit their tiny lenses; the physical floor — not a width policy — decides any collapse.

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
  bridgeGapAnchored: ReadonlySet<string>,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): void {
  const { columns } = section
  if (columns.length < 2) return
  // PART B (ruling 8i(e)): the direction-blind ``bridgeAnchored`` set is no longer read by the
  // sweep — bridges now feed the corr arithmetic (``bridgeGapAnchored``), so a bridge endpoint
  // carrier reads corr ≥ 1 (onlap/band, never a suppressed lens) and pass-through columns lens.
  // ``emitSubTdLenses`` / the flag-OFF seam path still consume ``bridgeAnchored``.
  void bridgeAnchored
  let seq = 0
  const nextId = (): string => `term${seq++}`
  // A SEPARATE ``flood``-prefixed id space for the vacated-wedge closures.
  let fseq = 0
  const nextFloodId = (): string => `floodsw${fseq++}`
  // Per-gap matched-pair bands, computed once and reused by BOTH the left-look and the right-look
  // of the two columns bounding the gap (the gap is only the look-direction — ruling 8k).
  const bandsOfGap = new Map<number, ReturnType<typeof collectGapBands>>()
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
    // Look RIGHT into gap ci (this column is the gap's LEFT column, side 'left'). RULING 8i(e):
    // NO sub-snap-width guard — every 0-corr side lenses; the physical 1 mm floor decides collapse.
    if (ci + 1 < columns.length) {
      emitSideSweep(ci, 'left', ci, col, columns[ci + 1], gapBands(ci), activeTies, bridgeGapAnchored, lensLabels, nextId, nextFloodId, out)
    }
    // Look LEFT into gap ci-1 (this column is the gap's RIGHT column, side 'right').
    if (ci - 1 >= 0) {
      emitSideSweep(ci - 1, 'right', ci, col, columns[ci - 1], gapBands(ci - 1), activeTies, bridgeGapAnchored, lensLabels, nextId, nextFloodId, out)
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
  bridgeGapAnchored: ReadonlySet<string>,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  nextFloodId: () => string,
  out: InputCurve[],
): void {
  // ``colIndex`` is retained for signature parity / future per-column diagnostics; the
  // direction-blind bridge suppression that consumed it is deleted (Part B, ruling 8i(e)).
  void colIndex
  const left = side === 'left' ? col : facing
  const right = side === 'left' ? facing : col
  // RULING 8i CLASSIFY: effectiveCorrForSide is the SINGLE 2/1/0 source (leftSide/rightSide),
  // shared with the conformance gate. RULING 8i(e): it now FOLDS the bridge-anchor extension
  // (``bridgeGapAnchored``) too — a jump-tie's anchored contact reads TIED toward the span
  // (→ corr 1 → onlap riding the bridge), so bridges feed the arithmetic instead of being a
  // blanket sweep suppression (Part B narrows the old ``isBridged`` guard below).
  const corr = effectiveCorrForSide(gapIndex, side, col, facing, left, right, activeTies, bridgeGapAnchored)
  // Direct/derived-base tie flags (``tiedFlags``) — used by ``drawTermination`` for the ONLAP SIDE
  // (which contact the tip rides / which way the flood wedge fills), distinct from the effective
  // 2/1/0 corr (which folds ruling-8a derived BAND ties too). A lone-stack unit tied only by a
  // derived band must still flood away from its neighbour, which the direct-flag default picks.
  const flags = tiedFlags(gapIndex, side, col.units.length, activeTies)
  const colX = col.x
  const facingX = facing.x

  // PART B (ruling 8i(e)): the blanket ``isBridged → continue`` suppression is DELETED. With
  // bridges now feeding the corr arithmetic (Part A), a bridge-anchored contact reads TIED →
  // corr ≥ 1, so a bridge endpoint carrier NEVER lenses (it onlaps at corr 1 riding the bridge,
  // or is a corr-2 band member skipped below) — the suppression the guard provided is now
  // structural in the arithmetic, and blanket-suppressing also killed the ZONE's genuine
  // pass-through lenses (the col8 SILT+SAND, owner's 456.07 find). A sub-TD bridge-anchored deep
  // unit is still handled by ``emitSubTdLenses`` (its own bridge guard leaves it to the
  // substrate); the sub-TD deferral below routes it there. The direction-blind ``bridgeAnchored``
  // set is now consumed ONLY by ``emitSubTdLenses`` / the flag-OFF seam bracket lookup.
  // The facing column's TD: a unit entirely below it is a SUB-TD minority owned by
  // ``emitSubTdLenses`` — the sweep DEFERS so a lens is never double-emitted.
  let facingTD = Infinity
  for (const fu of facing.units) if (fu.baseElev < facingTD) facingTD = fu.baseElev
  // The gap's shallow TD (``max(leftTD, rightTD)``) — the TD-floor polyline a ``td`` boundary
  // lens's base rides. ``col``'s own TD may be shallower or deeper than the facing's.
  let colTD = Infinity
  for (const cu of col.units) if (cu.baseElev < colTD) colTD = cu.baseElev
  const shallowTD = Math.max(colTD, facingTD)

  for (let ui = 0; ui < col.units.length; ui++) {
    const eff = corr[ui] ?? { topTied: false, baseTied: false, corr: 0 as const }
    const c = eff.corr
    if (c === 2) continue // band member / first-unit band — given line art (bandc), no termination
    // Sub-TD deferral: a unit entirely below the facing TD is ``emitSubTdLenses``' job (its
    // M-in-M annulus + bridge guards are the safe sub-TD wall; the sweep defers so no double
    // emit). Ruling 8i(e) "everything must lens" is honoured THERE (Part D relaxes its run-trim).
    if (col.units[ui].topElev <= facingTD - ELEV_EPS) continue
    const u = col.units[ui]

    if (c === 0 && !isMinorityWide(col, ui)) {
      // WATERTIGHT BOUNDARY LENS (owner directive session 20, 2026-07-17: "lensing needs to be
      // watertight by design"). A boundary minority — the FIRST unit (top rides the top band) or
      // the LAST unit (base rides the shallow-TD floor) with a differing single neighbour — LENS
      // like any 0-corr side (ruling 8i(e)). Its tied leg RIDES the boundary polyline (existing
      // line art), so the lens closes as column-vertical + one free flank + the polyline; the
      // enclosing flood already fills the width past the apex (``emitBoundaryLens`` draws NO
      // separate wedge — that double-covered the fill with a different-litho band, session 20).
      // REPLACES the session-19 ``boundaryResidual`` no-op (the interior lens shape left a
      // linearly-growing +65-hole sliver against the boundary polyline; reverted, characterised).
      const bk = boundaryMinorityKind(col, ui)
      if (bk !== null) {
        emitBoundaryLens(u, bk, colX, facingX, facing, shallowTD, lensLabels, nextId, out)
        continue
      }
      // MINORITY-vs-DOMINANT fill gate (owner 8f/8h): a 0-corr unit lenses iff it is a genuine
      // interior minority (both own-column neighbours a DIFFERENT formation, so the enclosing
      // floods around it). A boundary / dominant matrix unit with a SAME-formation neighbour
      // FLOODS instead — pinching a same-formation continuation to 0.5 breaks its band → holes.
      // This is the STRUCTURAL fill rule (who holds the void), NOT a ruling-8i draw decision.
      continue
    }

    const df = flags[ui] ?? { top: false, base: false }

    // RULING 8d-rev (owner, 2026-07-16 — "the top band counts as one correlation"; design §8
    // 8d-rev): a FIRST unit tied ONLY by the top band is now corr 1 and ONLAPS riding the SURFACE.
    // Route it to the WATERTIGHT surface onlap (``emitSurfaceOnlapFlank``): its tied leg rides the
    // ``surface:gi`` top-band polyline (existing line art) exactly like session-20's boundary lens,
    // but with the 0.5 onlap apex + phase-2 ``oflank`` id. This fires ONLY when the sole anchor is
    // the top band (ui 0, corr 1, no direct/derived-base tie on either own contact, base untied);
    // a first unit with a REAL top tie flows to ``drawTermination`` (its ``emitOnlap`` rides that
    // real tie). Distinct from the generic ``emitOnlap``, whose ``tieFacingElevAt`` falls back to
    // ``facingElevAt`` (NOT the top-band polyline) → a divergent tied leg → a sliver hole.
    if (ui === 0 && c === 1 && eff.topTied && !eff.baseTied && !df.top && !df.base) {
      emitSurfaceOnlapFlank(u, colX, facingX, facing, lensLabels, nextId, nextFloodId, out)
      continue
    }

    // RULING 8i DRAW: 0 → lens always (physical suppressions only); 1 → follow the tie
    // (same litho on the matched facing side → merge; different → onlap); 2 → handled above.
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
 * The BOUNDARY-minority test (session 20, watertight boundary lens). A 0-corr unit is a
 * boundary minority when it is the FIRST unit (``ui 0``, top rides the top band) or the LAST
 * unit (``ui last``, base rides the shallow-TD floor) AND its single interior neighbour is a
 * DIFFERENT formation. Such a unit lenses via ``emitBoundaryLens`` (its tied leg rides the
 * boundary polyline, hole-free) — distinct from an INTERIOR minority (handled by ``emitLens``
 * via ``isMinorityWide``). A boundary unit whose single neighbour is the SAME formation is NOT
 * a minority (it merges into that same-formation body — pinching it would break its band); a
 * degenerate single-unit column (no neighbour) has no lateral minority.
 *
 * Returns the boundary kind (``'surface'`` for a first unit, ``'td'`` for a last unit) or
 * ``null`` when the unit is not a boundary minority (interior, single-unit, or same-formation
 * neighbour).
 */
function boundaryMinorityKind(col: ColumnGeom, ui: number): 'surface' | 'td' | null {
  const self = col.units[ui]
  const isFirst = ui === 0
  const isLast = ui + 1 >= col.units.length
  // Interior unit (has both neighbours) — not a boundary minority (``isMinorityWide`` owns it).
  if (!isFirst && !isLast) return null
  // Degenerate single-unit column — no interior neighbour, no lateral minority.
  if (isFirst && isLast) return null
  const neighbour = isFirst ? col.units[1] : col.units[ui - 1]
  if (neighbour.formationId === self.formationId) return null // same-formation → merges, no lens
  return isFirst ? 'surface' : 'td'
}

/**
 * The minority test for the 0-corr fill gate — RELAXED to ruling 8i(e) (owner, 2026-07-17:
 * "everything must lens … all 0-corr bodies lens in first instance").
 *
 * INTERIOR unit (both neighbours exist): a minority whenever BOTH its immediate neighbours are a
 * DIFFERENT formation from it (the round-1 same-formation enclosure ``above === below ≠ self``
 * PLUS the MIXED-bracket case ``above ≠ below, both ≠ self`` — the Tie-6/9/11 VEEN class).
 *
 * BOUNDARY unit (ui 0 = surface-topped, or ui last = TD-based): PREVIOUSLY excluded wholesale (it
 * was assumed the dominant flooding matrix — the +59-hole guard). Ruling 8i(e) requires it to lens
 * too WHEN it is a genuine minority: its SINGLE interior neighbour is a DIFFERENT formation. A thin
 * first unit (Tie-10/12 top ZAND, CS1 S8 top ZAND, CS2 B8 top SILT) or a thin last unit (CS1 S8
 * base SILT) whose one neighbour differs is a minority the enclosing (that neighbour, laterally the
 * facing formation) floods around — not a dominant matrix. A boundary unit whose single neighbour
 * is the SAME formation is still NOT a minority (it merges into that same-formation body → no lens,
 * hole-safe: pinching a same-formation continuation to 0.5 would break its band). A degenerate
 * single-unit column (no neighbour) has no lateral minority → excluded.
 */
function isMinorityWide(col: ColumnGeom, ui: number): boolean {
  const self = col.units[ui]
  const hasAbove = ui > 0
  const hasBelow = ui + 1 < col.units.length
  if (hasAbove && hasBelow) {
    const above = col.units[ui - 1]
    const below = col.units[ui + 1]
    return above.formationId !== self.formationId && below.formationId !== self.formationId
  }
  // BOUNDARY unit (ui 0 surface-topped / ui last TD-based): ruling 8i(e) wants it to lens too when
  // its single interior neighbour differs, BUT the ONE-run OFF/ON battery (session 19) measured that
  // firing the lens here opens the +59-class fill hole — the enclosing flood behind a first/last-unit
  // lens does NOT close the vacated wedge (Tie-10 g0 top ZAND: +63 holes; Tie-12 g0 top ZAND: +2). The
  // lens CURVE is emitted (LENS_AUDIT MISSING drops to 0), but ``emitEnclosingFlood``'s interval closure
  // cannot bound a surface-/TD-boundary lens hole-free — the documented multi-day fill-rebuild wall
  // (design §4 "cannot land as one increment with the holes-0/0/0 bar"). Per Part-D "characterise +
  // stop" this boundary case stays EXCLUDED from the sweep lens until that fill rebuild; the audit
  // flags these as the boundary-lens residual (5 units, all with a differing single neighbour).
  void hasAbove
  void hasBelow
  return false // boundary / single-unit column — excluded pending the emitEnclosingFlood rebuild
}
