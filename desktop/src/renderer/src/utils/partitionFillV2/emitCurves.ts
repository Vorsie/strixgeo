/**
 * partitionFillV2/emitCurves.ts — curve emission (design §2, §3 step 1).
 *
 * Turns the litho columns + approved correlation edges into the four families of
 * input curves the planar arrangement traces (design partition-engine-v2.md §2):
 *
 *   1. column-vertical — each investigation's footprint edge, surface → TD, at
 *      its REAL alongM (uniform spacing diverges; memory
 *      ``feedback_partitionfill_needs_alongm``).
 *   2. contact        — a unit top/base along its own column face. In the
 *      metres×elevation arrangement a column has zero width, so a "contact
 *      segment" is emitted as the column-vertical sub-run between two contact
 *      elevations; contact ENDPOINTS become the vertices ties/closings attach to.
 *      (We split the column vertical at every contact elevation by emitting one
 *      curve per unit face, so the arrangement has a vertex at every contact.)
 *   3. tie           — an approved correlation edge spanning a gap, side-aware
 *      (top/base), connecting facing contact endpoints.
 *   4. closing       — synthesized vacancy-closure geometry (``emitIntervals``):
 *      the untied units of each interval between tie-anchored bands TILE it fully,
 *      meeting at a seam, so the space past a pinch/lens apex is CLAIMED (design §4
 *      increment 4 — no above-TD holes). Enclosed minorities pinch to a 0.45 lens
 *      apex inside a continuous matrix; per-body apex overrides / freedraw nodes
 *      REPLACE the synthesized apex.
 *
 * Deep-to-deep substrate bridges (``emitSubstrate``) run before the closings so a
 * bridge-anchored deep unit skips its interval tiling. Below a shallow TD with no
 * bridge the region stays unfilled (owner §8 Q3).
 *
 * Crossing approved ties are a HARD CONFLICT (owner §8 Q4): a pair of
 * geometrically crossing ties in the same gap both drop out of emission and are
 * reported in ``conflicts``; the two units then fall back to the interval tiling.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { detectCrossingConflicts, edgeKey, type CrossingConflict } from './crossingConflicts'
import { emitBottomTieSubstrate } from './emitBottomTieSubstrate'
import { emitEnclosingFlood } from './emitEnclosingFlood'
import { emitRuledBands } from './emitRuledBands'
import { emitEnclosedLensCurves, type LensLabel } from './emitLenses'
import { emitIntervalCurves } from './emitIntervals'
import { emitSubstrateBridges } from './emitSubstrate'
import { emitSubTdLenses } from './emitSubTdLenses'
import { emitTerminationSweep } from './emitTerminationSweep'
import { twoSidedTerminationsEnabled } from './tileFlags'
import { firstLithoTopElev, type ColumnGeom, type SectionInput } from './sectionGeom'
import { type CorrelationEdge } from '../partitionFill'
import { type InputCurve, type Point } from './types'

/**
 * A tie resolved to concrete geometry across ONE gap: the two facing contact
 * endpoints it connects, side-aware, plus provenance (which unit/side on each
 * column) for later face labelling and closing-curve fallback.
 */
export interface ResolvedTie {
  /** Gap index (left column index in the non-empty column list). */
  gapIndex: number
  /** Endpoint on the LEFT column. */
  left: Point
  /** Endpoint on the RIGHT column. */
  right: Point
  /** Side of the left unit's contact this tie joins. */
  leftSide: 'top' | 'base'
  /** Side of the right unit's contact this tie joins. */
  rightSide: 'top' | 'base'
  /** Left column unit index this tie's left endpoint sits on. */
  leftUnitIndex: number
  /** Right column unit index. */
  rightUnitIndex: number
  /** Stable curve id. */
  id: string
}

/**
 * A detected crossing-tie conflict: the two approved edges (adjacent ties AND/OR
 * jump-tie bridges) that geometrically cross in a gap (owner §8 Q4). Re-exported
 * from ``crossingConflicts`` — the canonical shape now carries the suspended
 * edges' order-invariant keys (``edgeKeys``) in addition to the historical
 * ``gapIndex`` + ``tieIds`` (backward compatible).
 */
export type TieConflict = CrossingConflict

/** Result of curve emission: the arrangement curves plus detected conflicts. */
export interface EmittedCurves {
  curves: InputCurve[]
  conflicts: TieConflict[]
  /** The ties that survived conflict pruning, per gap — used by labelling. */
  activeTies: ResolvedTie[]
  /**
   * ``lens<n>`` curve id -> the litho identity that curve's traced FACE carries.
   * An enclosed-lens face is bounded by the matrix column-vertical too, so its
   * label must come from here (the lens's own litho), not the matrix.
   */
  lensLabels: Map<string, LensLabel>
}

/**
 * Emit all four curve families for a whole section.
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     Columns (with elevations precomputed) + resolved edge sets + alongM.
 *
 * Returns
 * -------
 * EmittedCurves
 *     ``curves`` for ``buildArrangement``, plus ``conflicts`` and the surviving
 *     ``activeTies`` (for face labelling).
 */
export function emitCurves(section: SectionInput): EmittedCurves {
  const curves: InputCurve[] = []
  emitColumnVerticals(section.columns, curves)
  emitSurfaceCurves(section.columns, curves)

  // ONE crossing-conflict pass over EVERY approved edge — adjacent ties AND
  // jump-tie bridges canonicalised into gap-local segments (owner §8 Q4, design
  // §4 "Band authority" row). Any edge in any crossing is SUSPENDED: dropped from
  // BOTH emission paths (ties + bridges) so its units fall back to 0/1-corr
  // termination. This replaces the old adjacent-only ``pruneCrossingTies``, which
  // let a bridge crossing another bridge / an adjacent tie enter unchecked.
  const { suspended, conflicts } = detectCrossingConflicts(section)
  // The surviving-edge section fed to both emission paths — a suspended edge is
  // absent everywhere (never a tie curve, never a bridge, never a bottom-tie
  // reach). Built once; ``section`` itself is not mutated (pure).
  const survivingSection: SectionInput =
    suspended.size === 0
      ? section
      : {
          ...section,
          edges: (section.edges as readonly CorrelationEdge[]).filter(
            (e) => !suspended.has(edgeKey(e)),
          ),
        }

  const ties = resolveTies(survivingSection)
  for (const t of ties) {
    curves.push({
      id: t.id,
      kind: 'tie',
      points: [t.left, t.right],
    })
  }

  // Deep-to-deep substrate bridges: jump ties (non-adjacent correlation edges)
  // become bridge curves through the intervening columns so the sub-shallow-TD
  // region traces as ordinary faces (design §4; owner §8 Q3). Emitted BEFORE the
  // closings so the closing pass can skip a deep anchor unit whose contacts a
  // bridge already carries (else it pinches to a lens apex into the gap). Consumes
  // only surviving edges (a suspended bridge is dropped here too — Q4).
  const bridgeAnchored = new Set<string>()
  emitSubstrateBridges(survivingSection, curves, bridgeAnchored)

  // The shared ``lensLabels`` map: created BEFORE the interval closures so a lone-side
  // pinch's flood-wedge curves (emitLonePinch) can register their bracket-matrix label
  // here, then consumed by ``labelFaces`` (design §4 finding A). Enclosed-lens and
  // substrate curves append to the same map below.
  const lensLabels = new Map<string, LensLabel>()

  // THE HOIST (session 15) — WIRED when the cut-over flag is ON (``twoSidedTerminationsEnabled``).
  // In the owner's paint-bucket order (given line art → GENERATED ties → fill): the UNCONDITIONAL
  // termination sweep (``emitTerminationSweep``, 0→lens / 1→onlap per gap/side/unit) draws every
  // lens/onlap FIRST, then the fill-only enclosing flood (``emitEnclosingFlood``, owner 8f "fill
  // the void with the dominant lithology") closes the enclosing faces behind them so the sweep's
  // terminations carve holes/detours BY CONSTRUCTION. This DELETES the tilers' termination
  // emission (``emitIntervalCurves`` / ``tileGapTwoSided`` and its lone / coherent / converging
  // routers are BYPASSED when the flag is on). ``emitSubTdLenses`` + ``emitEnclosedLensCurves``
  // (the proven column-merge carriers) STILL run below — the sweep DEFERS to them for the sub-TD
  // and enclosed-minority cases (it never double-emits: the sub-TD deferral skips sub-TD units,
  // and ``emitEnclosedLensCurves`` handles the same-formation-enclosed minorities the sweep's
  // ``isMinority`` gate also targets — but those units were already MERGED out of the column by
  // ``sectionGeom.extractEnclosedLenses``, so the sweep's ``isMinority`` never sees them).
  // Flag OFF: the seam-based ``emitIntervalCurves`` runs, byte-identical to the session-13 baseline.
  if (twoSidedTerminationsEnabled()) {
    emitTerminationSweep(survivingSection, ties, bridgeAnchored, lensLabels, curves)
    emitEnclosingFlood(survivingSection, ties, bridgeAnchored, lensLabels, curves)
    // RULED-EXEMPT band closures (round-3 Target 1): the sweep suppresses a termination for
    // every unit the owner ruled a BAND (8e / 8g(b) / corr-2 band member), but the flood does
    // not fill their OWN formation — a neighbouring flood face absorbs their space and they read
    // ABSENT. This pass emits each such unit's missing same-formation band contour so its face
    // closes and its column vertical labels it (the asymmetric ``emitBands`` device).
    emitRuledBands(survivingSection, ties, lensLabels, curves)
  } else {
    // Vacancy closure (design §4 increment 4): the untied units of each interval
    // between tie-anchored bands TILE it fully (opposing pinches meeting at a seam),
    // so the vacated space past a pinch/lens apex is CLAIMED — no above-TD holes.
    emitIntervalCurves(survivingSection, ties, bridgeAnchored, lensLabels, curves)
  }

  emitEnclosedLensCurves(survivingSection, curves, lensLabels)

  // Deep-to-deep FLAT-FLOOR substrate (design §4 increment-6): where a bottom-tie
  // bracket reaches below a shallow column's TD, flatten the deepest band's base to
  // that flat floor (v1 ``computeBottomTieLine`` + ``isDeepestBridge``). This fills
  // the triangular sub-TD void the sloping TD line left (CS1 gap-0/gap-21). A strip
  // with no bracket stays empty (owner §8 Q3 — ``tieElev`` null). Substrate curves
  // carry an explicit bottom-tie label in ``lensLabels`` so the sub-TD wedge is
  // stamped with the tie formation, not the shallow column's deepest unit.
  emitBottomTieSubstrate(survivingSection, curves, lensLabels)

  // SUB-TD per-side hugging lenses (owner ruling 2026-07-16 night: "0 correlations, left
  // or right = lens to the same side, INCLUDING sub-TD"). A 0-corr unit entirely below the
  // FACING column's TD is swept by the deep-to-deep substrate above; it must still hug its
  // column with a lens. Emitted AFTER the substrate so the lens closing carves a HOLE in the
  // continuous substrate band by construction (the col3 interbed-lens proof) — the substrate
  // floor/curtain/bridge curves are untouched (owner §8 Q3 / ruling 6 preserved). Guarded so
  // a lens only fires where the flooding substrate DIFFERS from the unit (no same-formation
  // annulus — the session-9/12 sub-TD wall).
  emitSubTdLenses(survivingSection, ties, bridgeAnchored, lensLabels, curves)

  return { curves, conflicts, activeTies: ties, lensLabels }
}

/**
 * Emit one ``column-vertical`` curve per unit face on every column: the column
 * line from the unit's top elevation to its base elevation. Splitting per unit
 * guarantees an arrangement vertex at every contact elevation (where ties /
 * closing curves attach). The stack is gap-free (normalised upstream), so the
 * per-unit verticals tile the whole column surface→TD.
 */
function emitColumnVerticals(columns: readonly ColumnGeom[], out: InputCurve[]): void {
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci]
    for (let ui = 0; ui < col.units.length; ui++) {
      const u = col.units[ui]
      // Ruling 5-REVISED (2026-07-14 evening): the FIRST unit's column vertical returns to
      // its own DRILLED top (``u.topElev``), NOT the ground surface. The owner rejected the
      // surface extension on round-2 dogfeed ("that quad is made up") — the strip between the
      // top-band line and the ground stays EMPTY, no invented lithology above the first data
      // point. The top-band polyline (``emitSurfaceCurves`` → ``firstLithoTopElev``) rides this
      // first-litho boundary; ties/bands anchor at the drilled contact unchanged.
      out.push({
        id: `col${ci}:u${ui}`,
        kind: 'column-vertical',
        points: [
          { x: col.x, y: u.topElev },
          { x: col.x, y: u.baseElev },
        ],
      })
    }
  }
}

/**
 * Emit the TOP-BAND curve spanning each gap — from the left column's first-litho-top
 * elevation to the right column's (ruling 5-revised; ``firstLithoTopElev``). This is the
 * band-authority top polyline: it rides each column's FIRST LITHO BOUNDARY, not the ground
 * surface, so the strip between it and the ground stays EMPTY. It still encloses the top of
 * every gap so a unit that pinches out at/near the top-band leaves a CLOSED vacancy face
 * (the rising matrix) instead of an open, untraced region above the shallowest tie. The
 * FLOOR is deliberately NOT emitted: the sub-TD void below a shallow column stays open
 * (unfilled) until the deep-to-deep substrate bridges.
 */
function emitSurfaceCurves(columns: readonly ColumnGeom[], out: InputCurve[]): void {
  for (let gi = 0; gi + 1 < columns.length; gi++) {
    const left = columns[gi]
    const right = columns[gi + 1]
    out.push({
      id: `surface:${gi}`,
      kind: 'closing',
      points: [
        { x: left.x, y: firstLithoTopElev(left) },
        { x: right.x, y: firstLithoTopElev(right) },
      ],
    })
  }
}

/**
 * Resolve every approved edge that straddles an adjacent gap to concrete tie
 * geometry (endpoint on each facing column). Only ADJACENT-column ties are
 * emitted as curves — a jump tie across a data void has no facing pair of
 * columns and is left for increment 3's substrate bridges.
 *
 * A tie's endpoint elevation depends on the side (``top`` → the unit's top
 * contact; ``base`` → the unit's base contact).
 */
function resolveTies(section: SectionInput): ResolvedTie[] {
  const { columns } = section
  const out: ResolvedTie[] = []
  // layerId → {colIndex, unitIndex}
  const layerLoc = new Map<string, { ci: number; ui: number }>()
  for (let ci = 0; ci < columns.length; ci++) {
    for (let ui = 0; ui < columns[ci].units.length; ui++) {
      layerLoc.set(columns[ci].units[ui].layerId, { ci, ui })
    }
  }

  let tieSeq = 0
  for (const e of section.edges) {
    const la = layerLoc.get(e.a)
    const lb = layerLoc.get(e.b)
    if (!la || !lb) continue // endpoint not in this section
    // Only adjacent columns form a tie curve; non-adjacent = jump tie (incr 3).
    if (Math.abs(la.ci - lb.ci) !== 1) continue
    const leftLoc = la.ci < lb.ci ? la : lb
    const rightLoc = la.ci < lb.ci ? lb : la
    const leftSide = (la.ci < lb.ci ? e.aSide : e.bSide) ?? 'top'
    const rightSide = (la.ci < lb.ci ? e.bSide : e.aSide) ?? 'top'
    const lu = columns[leftLoc.ci].units[leftLoc.ui]
    const ru = columns[rightLoc.ci].units[rightLoc.ui]
    out.push({
      gapIndex: leftLoc.ci,
      left: { x: columns[leftLoc.ci].x, y: leftSide === 'top' ? lu.topElev : lu.baseElev },
      right: { x: columns[rightLoc.ci].x, y: rightSide === 'top' ? ru.topElev : ru.baseElev },
      leftSide,
      rightSide,
      leftUnitIndex: leftLoc.ui,
      rightUnitIndex: rightLoc.ui,
      id: `tie${tieSeq++}:${leftLoc.ci}`,
    })
  }
  return out
}
