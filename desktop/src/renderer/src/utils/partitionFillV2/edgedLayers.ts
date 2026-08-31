/**
 * partitionFillV2/edgedLayers.ts — PER-GAP edged-layer detection (the terminations-first
 * foundation, design partition-engine-v2.md §4 FINAL SHAPES fix-path row).
 *
 * The section-wide ``edgedLayerIds`` set (``sectionGeom.buildSectionInput``) is TOO COARSE
 * for the enclosed-minority extraction: it excludes a unit from lensing in gap M whenever
 * that unit is tied by ANY edge — including an edge that resolves to a DIFFERENT (adjacent)
 * gap N. The lens-edged conformance class (CS1 g22 SILT/ZAND, CS2 g21 SILT, CS1 g3 SILT —
 * doc §4 residual (b)) is exactly this: a minority TIED IN THE ADJACENT gap, so the
 * section-wide set blocks its column-level extraction, yet per the per-gap/per-side rule it
 * must still TERMINATE in THIS gap (a 0.45 lens when 0-corr, an onlap when 1-corr).
 *
 * This module computes the PER-GAP edged membership: a layerId is "edged in gap g" iff it
 * is an endpoint of an approved correlation edge whose two endpoints sit on the two ADJACENT
 * columns of gap g (the same adjacency test ``emitCurves.resolveTies`` uses to turn an edge
 * into a tie curve — a jump/non-adjacent edge belongs to no single gap and becomes a
 * substrate bridge, so it is NOT counted here). Session 2 wires this into a per-gap
 * enclosed-minority extraction that replaces the column pre-pass for the lens-edged class.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type CorrelationEdge } from '../sectionPartition'
import { type ColumnGeom } from './sectionGeom'

/**
 * A per-gap view of which layerIds are edged.
 *
 * ``sectionWide`` reproduces the existing ``buildSectionInput`` set (every layerId in any
 * edge) so callers can keep the current coarse behaviour where it is still correct.
 * ``inGap(layerId, gapIndex)`` is the fine per-gap membership the lens-edged fix needs.
 */
export interface EdgedLayers {
  /** Every layerId that participates in ANY approved edge (the coarse section-wide set). */
  sectionWide: ReadonlySet<string>
  /**
   * Whether ``layerId`` is tied by an edge resolving to gap ``gapIndex`` (an adjacent-column
   * edge whose lower column index equals ``gapIndex``). A layerId edged only in a DIFFERENT
   * gap returns ``false`` here even though ``sectionWide`` contains it.
   */
  inGap: (layerId: string, gapIndex: number) => boolean
}

/**
 * Build the per-gap edged-layer view for a resolved section.
 *
 * Parameters
 * ----------
 * columns : readonly ColumnGeom[]
 *     The resolved (post-normalisation) columns, in gap order — index ``ci`` is the left
 *     column of gap ``ci``. Used only to map each layerId to its column index.
 * edges : readonly CorrelationEdge[]
 *     The approved correlation edges (layer-id pairs).
 *
 * Returns
 * -------
 * EdgedLayers
 *     The section-wide set + the per-gap ``inGap`` predicate.
 */
export function buildEdgedLayers(
  columns: readonly ColumnGeom[],
  edges: readonly CorrelationEdge[],
): EdgedLayers {
  // layerId -> column index in the resolved column list.
  const colOf = new Map<string, number>()
  for (let ci = 0; ci < columns.length; ci++) {
    for (const u of columns[ci].units) colOf.set(u.layerId, ci)
  }

  const sectionWide = new Set<string>()
  // gapIndex -> set of layerIds edged in that gap.
  const perGap = new Map<number, Set<string>>()
  const addToGap = (gapIndex: number, layerId: string): void => {
    let s = perGap.get(gapIndex)
    if (!s) {
      s = new Set<string>()
      perGap.set(gapIndex, s)
    }
    s.add(layerId)
  }

  for (const e of edges) {
    sectionWide.add(e.a)
    sectionWide.add(e.b)
    const ca = colOf.get(e.a)
    const cb = colOf.get(e.b)
    // An edge belongs to a single gap only when its endpoints are on ADJACENT columns
    // (same test as resolveTies). A non-adjacent (jump) edge resolves to no single gap —
    // it becomes a deep-to-deep substrate bridge and is not a per-gap tie, so it is not
    // counted in any gap's edged set.
    if (ca === undefined || cb === undefined) continue
    if (Math.abs(ca - cb) !== 1) continue
    const gapIndex = Math.min(ca, cb)
    addToGap(gapIndex, e.a)
    addToGap(gapIndex, e.b)
  }

  return {
    sectionWide,
    inGap: (layerId: string, gapIndex: number): boolean => perGap.get(gapIndex)?.has(layerId) ?? false,
  }
}
