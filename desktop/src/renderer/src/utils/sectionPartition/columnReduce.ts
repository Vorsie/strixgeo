// sectionPartition/columnReduce.ts — the two column-reduction helpers that
// outlived the v1 engine (#280): gap closing, same-formation collapse and
// the bottom tie line. The rest of the old columnReduce (interval extraction, side reduction,
// TD arithmetic) served only the v1 fill and left with it.

import { type PartitionColumn, type PartitionUnit } from './types'

/**
 * Snap each unit's base to the next unit's top, in place, so the column is
 * gap-free and overlap-free before tiling.
 *
 * The accepted litho layers feeding a column can carry a depth GAP (a
 * rejected/collapsed segment whose ``depth_base`` no longer meets the next
 * unit's ``depth_top``). The litho bands hide this by rendering
 * contact→next-contact; the partition fill must do the same or it shows a HOLE
 * (dogfeed 2026-06-08). Units must already be sorted by ``topDepthM``.
 *
 * Parameters
 * ----------
 * units : PartitionUnit[]
 *     The column's units, sorted shallow→deep. Mutated in place (the deepest
 *     unit keeps its own base — the column floor).
 */
export function closeColumnGaps(units: PartitionUnit[]): void {
  for (let i = 0; i < units.length - 1; i++) {
    units[i].baseDepthM = units[i + 1].topDepthM
  }
}

/**
 * Merge runs of adjacent same-``formationId`` units into one (lithology is the
 * fill primitive — a stack of same-lithology beds is one matrix band, regardless
 * of how the resolver split it into bodies). Without this, when one column's
 * matrix is one unit and the other's is split into N (different ``bodyId``s, or
 * exposed by removing an interbedded lens), the matcher orphans the surplus
 * pieces into spurious pinches. Keeps the shallowest unit's ``bodyId`` as the
 * run's representative. Mutates in place.
 *
 * The merge is gated on ``bodyId`` AS WELL AS ``formationId`` — only adjacent
 * units that share BOTH merge. WHY (spec §9 body-split, the S6 case): when
 * ``reduceColumn`` pulls an intervening lens, two NON-ADJACENT occurrences of the
 * same lithology that are DISTINCT bodies (e.g. a 0.3 m shallow ZAND sliver,
 * body A, and the thick deep ZAND, body B, separated by a pulled SILT/KLEI) would
 * otherwise become adjacent and merge into one body — erasing the deep-sand-top
 * surface a correlation tie needs to attach to. Gating on ``bodyId`` keeps them
 * distinct. ``null === null`` is true, so two uncorrelated (null-body)
 * same-lithology matrix layers still collapse (intended); only genuinely
 * different bodies of the same lithology are kept separate.
 */
export function collapseAdjacentSameFormation(units: PartitionUnit[]): void {
  for (let i = units.length - 2; i >= 0; i--) {
    if (
      units[i].formationId === units[i + 1].formationId &&
      units[i].bodyId === units[i + 1].bodyId
    ) {
      units[i].baseDepthM = units[i + 1].baseDepthM
      units.splice(i + 1, 1)
    }
  }
}

/**
 * Compute the bottom-tie line: a per-column elevation array derived from
 * base-tie correlation edges (edges where both aSide and bSide are 'base').
 *
 * Each edge resolves to a segment between two column endpoints; at each
 * column index the value is the DEEPEST (lowest elevation = most negative)
 * interpolated value across all segments that span that column (the lower
 * envelope). Formation and body identity come from the deeper endpoint of the
 * winning segment. Columns not covered by any segment receive ``null`` except
 * at the outer edges, where a flat extension propagates the nearest covered
 * column's value outward (the substrate continues past the section ends).
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The section's columns in order, index 0..n-1. May be empty.
 * baseTieEdges : readonly { a: string; b: string }[]
 *     Layer-id pairs that represent base-tie edges. Each layerId is resolved
 *     by scanning ``columns[*].units`` for ``unit.layerId === id``. If either
 *     endpoint is not found the edge is skipped.
 *
 * Returns
 * -------
 * { tieElev, formationId, bodyId }
 *     Three parallel arrays of length ``columns.length``.
 *     ``tieElev[k]`` is the lower-envelope base elevation (mTAW) at column k,
 *     or ``null`` if no segment covers k (after flat extension is applied).
 *     ``formationId[k]`` / ``bodyId[k]`` are from the segment that produced
 *     the minimum elevation at k, or ``null`` when ``tieElev[k]`` is null.
 */
export function computeBottomTieLine(
  columns: readonly PartitionColumn[],
  baseTieEdges: readonly { a: string; b: string }[],
): { tieElev: (number | null)[]; formationId: (string | null)[]; bodyId: (string | null)[] } {
  const n = columns.length
  if (n === 0) return { tieElev: [], formationId: [], bodyId: [] }

  // Build a map from layerId → { colIndex, baseElev, formationId, bodyId }.
  interface LayerInfo {
    colIndex: number
    baseElev: number
    formationId: string
    bodyId: string | null
  }
  const layerMap = new Map<string, LayerInfo>()
  for (let ci = 0; ci < n; ci++) {
    const col = columns[ci]
    for (const unit of col.units) {
      layerMap.set(unit.layerId, {
        colIndex: ci,
        baseElev: col.surfaceElevM - unit.baseDepthM,
        formationId: unit.formationId,
        bodyId: unit.bodyId,
      })
    }
  }

  // Resolved segment: [loCol, hiCol] span + per-column interpolation function.
  interface Segment {
    loCol: number
    hiCol: number
    loElev: number
    hiElev: number
    /** formationId / bodyId of the DEEPER (lower elevation) endpoint. */
    formationId: string
    bodyId: string | null
  }
  const segments: Segment[] = []
  for (const edge of baseTieEdges) {
    const a = layerMap.get(edge.a)
    const b = layerMap.get(edge.b)
    if (a === undefined || b === undefined) continue
    // Order endpoints by column index.
    const [lo, hi] = a.colIndex <= b.colIndex ? [a, b] : [b, a]
    // Carry identity from the DEEPER (lower elevation) endpoint.
    const deeper = lo.baseElev <= hi.baseElev ? lo : hi
    segments.push({
      loCol: lo.colIndex,
      hiCol: hi.colIndex,
      loElev: lo.baseElev,
      hiElev: hi.baseElev,
      formationId: deeper.formationId,
      bodyId: deeper.bodyId,
    })
  }

  // Initialise result arrays with null.
  const tieElev: (number | null)[] = Array(n).fill(null)
  const formationId: (string | null)[] = Array(n).fill(null)
  const bodyId: (string | null)[] = Array(n).fill(null)

  // For each column covered by at least one segment, take the minimum elevation
  // (lower envelope). Ties → first segment wins (deterministic).
  for (const seg of segments) {
    if (seg.loCol === seg.hiCol) {
      // Degenerate single-column segment — just the endpoint value.
      const k = seg.loCol
      if (tieElev[k] === null || seg.loElev < tieElev[k]!) {
        tieElev[k] = seg.loElev
        formationId[k] = seg.formationId
        bodyId[k] = seg.bodyId
      }
      continue
    }
    const span = seg.hiCol - seg.loCol
    for (let k = seg.loCol; k <= seg.hiCol; k++) {
      const t = (k - seg.loCol) / span
      const elev = seg.loElev + t * (seg.hiElev - seg.loElev)
      if (tieElev[k] === null || elev < tieElev[k]!) {
        tieElev[k] = elev
        formationId[k] = seg.formationId
        bodyId[k] = seg.bodyId
      }
    }
  }

  // Flat extension: find the leftmost and rightmost covered column indices.
  let firstCovered = -1
  let lastCovered = -1
  for (let k = 0; k < n; k++) {
    if (tieElev[k] !== null) {
      if (firstCovered === -1) firstCovered = k
      lastCovered = k
    }
  }
  if (firstCovered === -1) {
    // No segments resolved at all — all remain null.
    return { tieElev, formationId, bodyId }
  }
  // Propagate leftward from firstCovered.
  for (let k = 0; k < firstCovered; k++) {
    tieElev[k] = tieElev[firstCovered]
    formationId[k] = formationId[firstCovered]
    bodyId[k] = bodyId[firstCovered]
  }
  // Propagate rightward from lastCovered.
  for (let k = lastCovered + 1; k < n; k++) {
    tieElev[k] = tieElev[lastCovered]
    formationId[k] = formationId[lastCovered]
    bodyId[k] = bodyId[lastCovered]
  }

  return { tieElev, formationId, bodyId }
}
