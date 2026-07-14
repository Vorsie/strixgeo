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

import { emitBottomTieSubstrate } from './emitBottomTieSubstrate'
import { emitEnclosedLensCurves, type LensLabel } from './emitLenses'
import { emitIntervalCurves } from './emitIntervals'
import { emitSubstrateBridges } from './emitSubstrate'
import { type ColumnGeom, type SectionInput } from './sectionGeom'
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

/** A detected crossing-tie conflict: the two ties that geometrically cross. */
export interface TieConflict {
  gapIndex: number
  /** The two conflicting tie curve ids. */
  tieIds: [string, string]
}

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

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

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

  const ties = resolveTies(section)
  const { active, conflicts } = pruneCrossingTies(ties, section.columns)
  for (const t of active) {
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
  // bridge already carries (else it pinches to a lens apex into the gap).
  const bridgeAnchored = new Set<string>()
  emitSubstrateBridges(section, curves, bridgeAnchored)

  // The shared ``lensLabels`` map: created BEFORE the interval closures so a lone-side
  // pinch's flood-wedge curves (emitLonePinch) can register their bracket-matrix label
  // here, then consumed by ``labelFaces`` (design §4 finding A). Enclosed-lens and
  // substrate curves append to the same map below.
  const lensLabels = new Map<string, LensLabel>()

  // Vacancy closure (design §4 increment 4): the untied units of each interval
  // between tie-anchored bands TILE it fully (opposing pinches meeting at a seam),
  // so the vacated space past a pinch/lens apex is CLAIMED — no above-TD holes. A
  // LONE-side untied unit (no facing counterpart) that v1 would pinch now emits a
  // pinch apex short of the far column + a flood wedge claiming the rest (finding A),
  // registering the flood label in ``lensLabels``.
  emitIntervalCurves(section, active, bridgeAnchored, lensLabels, curves)

  emitEnclosedLensCurves(section, curves, lensLabels)

  // Deep-to-deep FLAT-FLOOR substrate (design §4 increment-6): where a bottom-tie
  // bracket reaches below a shallow column's TD, flatten the deepest band's base to
  // that flat floor (v1 ``computeBottomTieLine`` + ``isDeepestBridge``). This fills
  // the triangular sub-TD void the sloping TD line left (CS1 gap-0/gap-21). A strip
  // with no bracket stays empty (owner §8 Q3 — ``tieElev`` null). Substrate curves
  // carry an explicit bottom-tie label in ``lensLabels`` so the sub-TD wedge is
  // stamped with the tie formation, not the shallow column's deepest unit.
  emitBottomTieSubstrate(section, curves, lensLabels)

  return { curves, conflicts, activeTies: active, lensLabels }
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
 * Emit the SURFACE curve spanning each gap — from the left column's surface
 * elevation to the right column's. This encloses the top of every gap so a unit
 * that pinches out at/near the surface leaves a CLOSED vacancy face (the rising
 * matrix) instead of an open, untraced region above the shallowest tie. The
 * FLOOR is deliberately NOT emitted: the sub-TD void below a shallow column stays
 * open (unfilled) until increment 3's deep-to-deep substrate bridges.
 */
function emitSurfaceCurves(columns: readonly ColumnGeom[], out: InputCurve[]): void {
  for (let gi = 0; gi + 1 < columns.length; gi++) {
    const left = columns[gi]
    const right = columns[gi + 1]
    out.push({
      id: `surface:${gi}`,
      kind: 'closing',
      points: [
        { x: left.x, y: left.surfaceElevM },
        { x: right.x, y: right.surfaceElevM },
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

/**
 * Detect geometrically crossing ties within a gap (owner §8 Q4 — HARD CONFLICT).
 * Two ties in the same gap CROSS iff their left endpoints and right endpoints are
 * in opposite vertical order (one starts above the other on the left but ends
 * below on the right). Every tie involved in ANY crossing is suspended; the
 * survivors are returned. Conflicts are reported for the UI warning surface.
 */
function pruneCrossingTies(
  ties: readonly ResolvedTie[],
  columns: readonly ColumnGeom[],
): { active: ResolvedTie[]; conflicts: TieConflict[] } {
  void columns
  const byGap = new Map<number, ResolvedTie[]>()
  for (const t of ties) {
    if (!byGap.has(t.gapIndex)) byGap.set(t.gapIndex, [])
    byGap.get(t.gapIndex)!.push(t)
  }
  const suspended = new Set<string>()
  const conflicts: TieConflict[] = []
  for (const group of byGap.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]
        const dLeft = a.left.y - b.left.y
        const dRight = a.right.y - b.right.y
        // Opposite sign on the two ends ⇒ the segments cross. Shared endpoints
        // (dLeft or dRight == 0) do not count as a crossing.
        if (Math.abs(dLeft) > ELEV_EPS && Math.abs(dRight) > ELEV_EPS && dLeft * dRight < 0) {
          suspended.add(a.id)
          suspended.add(b.id)
          conflicts.push({ gapIndex: a.gapIndex, tieIds: [a.id, b.id] })
        }
      }
    }
  }
  const active = ties.filter((t) => !suspended.has(t.id))
  return { active, conflicts }
}
