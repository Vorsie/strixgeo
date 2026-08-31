/**
 * partitionFillV2/crossingConflicts.ts — the SINGLE crossing-tie conflict pass
 * (owner §8 Q4: crossing approved ties are a HARD CONFLICT).
 *
 * The design's Q4 ruling — "crossing approved ties are a HARD CONFLICT; neither
 * bands, both fall back to pinch/lens, and the user gets a visual warning until
 * resolved" — must hold for EVERY approved edge, not just the adjacent per-gap
 * ties. Two edge families reach the arrangement:
 *
 *   - ADJACENT ties (``|ci - cj| === 1``) → emitted as ``tie`` curves by
 *     ``emitCurves.resolveTies``.
 *   - JUMP ties / BRIDGES (``|ci - cj| >= 2``) → emitted as deep-to-deep
 *     substrate bridge curves by ``emitSubstrate.emitSubstrateBridges`` AND feed
 *     the flat-floor substrate reach in ``emitBottomTieSubstrate``.
 *
 * Before this module the crossing check lived in ``emitCurves.pruneCrossingTies``
 * and saw ONLY the adjacent ties. A bridge crossing another bridge — or a bridge
 * crossing an adjacent tie in a gap it passes through — silently entered the
 * arrangement: invalid correlation input became apparently-valid fill.
 *
 * The fix canonicalises EVERY approved edge into gap-local SEGMENTS before any
 * emission:
 *
 *   - an adjacent tie contributes one segment in its single gap;
 *   - a bridge spanning columns ``lo..hi`` contributes one segment PER gap
 *     ``j`` it crosses (``lo <= j < hi``), whose left/right elevations are the
 *     bridge polyline's interpolated elevation at columns ``j`` and ``j+1``
 *     (linear in real alongM — the same interpolation ``emitSubstrateBridges``
 *     samples).
 *
 * Crossing detection then runs over the FULL segment set per gap (the same
 * opposite-vertical-order test as before). Every edge that participates in ANY
 * crossing, in ANY gap it spans, is SUSPENDED: it is removed from both emission
 * paths (adjacent ties AND bridges) and reported in ``conflicts``. The affected
 * units then fall back to normal 0/1-corr termination geometry.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type SectionInput } from './sectionGeom'
import { type CorrelationEdge } from '../sectionPartition'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/**
 * A stable identity for an approved edge, independent of index order. Two edges
 * with the same endpoint layer ids + sides are the same correlation regardless of
 * which endpoint the caller listed first, so the key is order-invariant.
 */
export function edgeKey(e: CorrelationEdge): string {
  const a = `${e.a}#${e.aSide ?? 'top'}`
  const b = `${e.b}#${e.bSide ?? 'top'}`
  return a <= b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * A detected crossing conflict: the two approved edges that geometrically cross
 * in some gap. Both are suspended. ``gapIndex`` is a gap where the crossing was
 * observed (a bridge may cross in several gaps — the first is reported).
 *
 * Backward-compatible with the historical ``TieConflict`` shape: ``gapIndex`` +
 * ``tieIds`` (the two curve/edge ids) are unchanged; ``edgeKeys`` is ADDED so a
 * consumer can identify the suspended correlation edges (bridge OR adjacent tie)
 * without reaching into the curve-id vocabulary.
 */
export interface CrossingConflict {
  gapIndex: number
  /** The two conflicting curve/edge ids (adjacent-tie ids or bridge edge keys). */
  tieIds: [string, string]
  /** The two conflicting approved edges' order-invariant keys (``edgeKey``). */
  edgeKeys: [string, string]
}

/** A canonicalised gap-local segment of one approved edge. */
interface EdgeSegment {
  /** The gap this segment spans (left column index). */
  gapIndex: number
  /** Elevation at the left column of the gap. */
  leftY: number
  /** Elevation at the right column of the gap. */
  rightY: number
  /** The owning edge's order-invariant key. */
  key: string
  /** A display id for the conflict report (the edge's canonical id string). */
  id: string
}

/**
 * Canonicalise every approved edge that resolves within this section into its
 * gap-local segments, detect crossings across the full per-gap set, and return
 * the suspended-edge keys + the conflict report.
 *
 * An edge whose endpoints do not both resolve to units in this section is
 * skipped (it belongs to another section). A same-column ``|ci - cj| === 0``
 * edge contributes no segment (it spans no gap).
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     Normalised columns (elevations + real x) + the raw approved edges.
 *
 * Returns
 * -------
 * { suspended: Set<string>; conflicts: CrossingConflict[] }
 *     ``suspended`` holds ``edgeKey`` for every edge in any crossing; the emission
 *     paths drop those edges. ``conflicts`` is the UI/report payload.
 */
export function detectCrossingConflicts(section: SectionInput): {
  suspended: Set<string>
  conflicts: CrossingConflict[]
} {
  const { columns } = section
  // layerId → {colIndex, unitIndex} so a raw edge resolves to a concrete contact.
  const layerLoc = new Map<string, { ci: number; ui: number }>()
  for (let ci = 0; ci < columns.length; ci++) {
    for (let ui = 0; ui < columns[ci].units.length; ui++) {
      layerLoc.set(columns[ci].units[ui].layerId, { ci, ui })
    }
  }

  const byGap = new Map<number, EdgeSegment[]>()
  let seq = 0
  for (const e of section.edges as readonly CorrelationEdge[]) {
    const la = layerLoc.get(e.a)
    const lb = layerLoc.get(e.b)
    if (!la || !lb) continue // endpoint not in this section
    const span = Math.abs(la.ci - lb.ci)
    if (span < 1) continue // same column — spans no gap

    const loLoc = la.ci < lb.ci ? la : lb
    const hiLoc = la.ci < lb.ci ? lb : la
    const loSide = (la.ci < lb.ci ? e.aSide : e.bSide) ?? 'top'
    const hiSide = (la.ci < lb.ci ? e.bSide : e.aSide) ?? 'top'
    const loU = columns[loLoc.ci].units[loLoc.ui]
    const hiU = columns[hiLoc.ci].units[hiLoc.ui]
    const loX = columns[loLoc.ci].x
    const hiX = columns[hiLoc.ci].x
    if (Math.abs(hiX - loX) < 1e-9) continue
    const loElev = loSide === 'top' ? loU.topElev : loU.baseElev
    const hiElev = hiSide === 'top' ? hiU.topElev : hiU.baseElev

    const key = edgeKey(e)
    const id = `${key}@${seq++}`
    // The edge's elevation at a column x, linearly interpolated along the
    // straight lo→hi line in real alongM (matching the bridge polyline sampling).
    const elevAtX = (x: number): number => loElev + ((x - loX) / (hiX - loX)) * (hiElev - loElev)

    // One segment per gap the edge crosses. An adjacent tie (span 1) yields a
    // single segment; a bridge (span >= 2) yields one per intervening gap.
    for (let gi = loLoc.ci; gi < hiLoc.ci; gi++) {
      const leftY = elevAtX(columns[gi].x)
      const rightY = elevAtX(columns[gi + 1].x)
      const seg: EdgeSegment = { gapIndex: gi, leftY, rightY, key, id }
      const arr = byGap.get(gi)
      if (arr) arr.push(seg)
      else byGap.set(gi, [seg])
    }
  }

  const suspended = new Set<string>()
  const conflicts: CrossingConflict[] = []
  const reportedPairs = new Set<string>()
  for (const group of byGap.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]
        if (a.key === b.key) continue // two segments of the SAME edge never conflict
        const dLeft = a.leftY - b.leftY
        const dRight = a.rightY - b.rightY
        // Opposite sign on the two ends ⇒ the segments cross. Shared endpoints
        // (dLeft or dRight == 0) do not count as a crossing.
        if (Math.abs(dLeft) > ELEV_EPS && Math.abs(dRight) > ELEV_EPS && dLeft * dRight < 0) {
          suspended.add(a.key)
          suspended.add(b.key)
          // De-duplicate the report so a bridge×bridge crossing repeated across
          // several gaps is reported once (first gap), not per gap.
          const pairKey = a.key <= b.key ? `${a.key}~${b.key}` : `${b.key}~${a.key}`
          if (!reportedPairs.has(pairKey)) {
            reportedPairs.add(pairKey)
            conflicts.push({
              gapIndex: a.gapIndex,
              tieIds: [a.id, b.id],
              edgeKeys: [a.key, b.key],
            })
          }
        }
      }
    }
  }
  return { suspended, conflicts }
}
