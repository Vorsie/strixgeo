/**
 * partitionFillV2/outerEdgeTerminations.ts — which OUTER-column units are zero-tie.
 *
 * OWNER RULING 2026-09-04 ("zero ties = lens"), on the packaged build: a unit at the
 * bottom of the section's FIRST column, with no correlation on either side and no
 * further column beyond it, was drawn as an OPEN half-band running out to the section
 * boundary. Under "zero ties = lens" it must pinch out toward the edge as a LENS — the
 * same closed shape a zero-tie unit gets between two columns — never a band to the
 * boundary. A unit that DOES have a tie inward keeps extending outward to the boundary.
 *
 * The section's outer edges (left of the first column, right of the last) are NOT gaps,
 * so the arrangement engine emits nothing there — the outward extension is drawn by the
 * overlay's open-end stub (``PartitionFillOverlay``). This module hands that render the
 * ONE thing it cannot see for itself: the ENGINE'S OWN 2/1/0 classification of each
 * outer-column unit toward the interior. The overlay pinches a unit iff it is here.
 *
 * REUSE, NOT REIMPLEMENTATION: the classification is ``effectiveCorrForSide`` — the same
 * single 2/1/0 source the termination sweep and the conformance gate consume. This module
 * only points it at the two outward sides (the first column looking right, the last column
 * looking left) and collects the corr-0 layer ids.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { effectiveCorrForSide } from './effectiveCorr'
import { resolveTies } from './emitCurves'
import { buildSectionInput } from './sectionGeom'
import { type CorrelationEdge, type PartitionColumn } from '../sectionPartition'

/**
 * The layer ids of the OUTER columns' units that are zero-tie (corr 0) toward the
 * interior — the units the open-end stub must pinch out as a lens rather than extend
 * flat to the section boundary.
 *
 * Only the FIRST column's rightward look and the LAST column's leftward look are
 * classified: those are the two sides whose outward extension the overlay draws. An
 * interior column is never an outer edge, so its units are untouched here.
 *
 * The ties are the DIRECT adjacent correlation edges (``resolveTies``) — the deliberate
 * light path so this runs cheaply on every render (pan/zoom included) without the full
 * arrangement pass. It therefore does not fold jump-tie bridge anchors or crossing-tie
 * suspension; both are rare at an outer column and only shift the OUTER-stub shape of a
 * single unit (a suspended tie would pinch rather than extend). The interior fill, which
 * the engine owns, is unaffected.
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The section's litho columns, left→right (units shallow→deep).
 * edges : readonly CorrelationEdge[]
 *     Approved correlation edges (layer-id pairs, side-aware).
 * alongM : optional real along-section metres, 1:1 with ``columns``.
 *
 * Returns
 * -------
 * Set<string>
 *     Layer ids of outer-column units with zero effective ties toward the interior.
 */
export function outerColumnZeroTieLayerIds(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  alongM?: readonly number[],
): Set<string> {
  const out = new Set<string>()
  if (columns.length < 2) return out
  const section = buildSectionInput(columns, edges, undefined, alongM)
  const g = section.columns
  if (g.length < 2) return out
  const ties = resolveTies(section)

  // FIRST column looks RIGHT into gap 0 (it is that gap's LEFT column, side 'left').
  const firstCorr = effectiveCorrForSide(0, 'left', g[0], g[1], g[0], g[1], ties)
  g[0].units.forEach((u, ui) => {
    if (firstCorr[ui]?.corr === 0) out.add(u.layerId)
  })

  // LAST column looks LEFT into gap N-2 (it is that gap's RIGHT column, side 'right').
  const lastGap = g.length - 2
  const lastCorr = effectiveCorrForSide(
    lastGap,
    'right',
    g[g.length - 1],
    g[g.length - 2],
    g[g.length - 2],
    g[g.length - 1],
    ties,
  )
  g[g.length - 1].units.forEach((u, ui) => {
    if (lastCorr[ui]?.corr === 0) out.add(u.layerId)
  })

  return out
}
