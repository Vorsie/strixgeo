/**
 * partitionFillV2/outerEdgeTerminations.ts — how an OUTER-column unit terminates at the edge.
 *
 * OWNER RULING 2026-09-07 (installer #22 dogfeed), verbatim: "the basal clay on 20/034-S5
 * emits a lens to the left; it is a test on the utter left side, it should band left, like
 * all the other columns." A unit on the section's FIRST or LAST column has no neighbouring
 * test on the outward side — the oracle classifies that side ``edge-of-section`` — so there
 * is no data beyond it and the interpretation carries the last known layer flat to the
 * section boundary: EVERY unit on an outermost column bands to the edge, whatever its tie
 * count on the inner side.
 *
 * This REVERSES, at the outer edge only, the earlier "zero ties = lens" behaviour (owner
 * 2026-09-04) which pinched a zero-tie basal outer unit toward the boundary as a lens. That
 * pinch made the utter-left basal clay a lens while its siblings banded — exactly the
 * inconsistency the owner objected to. Interior zero-tie lenses BETWEEN two columns are a
 * different case and are unchanged (they still pinch inside their gap).
 *
 * The section's outer edges are NOT gaps, so the arrangement engine emits nothing there — the
 * outward extension is drawn by the overlay's open-end stub (``PartitionFillOverlay``). This
 * module tells that render which outer-column units to PINCH rather than band. Under the ruling
 * above no outer-column unit pinches, so it returns the EMPTY set; the overlay bands every
 * outer unit flat to the boundary.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type CorrelationEdge, type PartitionColumn } from '../sectionPartition'

/**
 * The layer ids of outer-column units the open-end stub must PINCH out toward the section
 * boundary rather than band flat to it.
 *
 * Under owner ruling 2026-09-07 every unit on an outermost column bands to the section edge,
 * so this is ALWAYS the empty set. The signature is preserved (the overlay still calls it) so
 * the render path is untouched — it now receives an empty set and bands every outer unit.
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The section's litho columns, left→right (units shallow→deep). Unused now — kept for the
 *     stable call site and in case a future ruling reintroduces a per-unit outer termination.
 * edges : readonly CorrelationEdge[]
 *     Approved correlation edges. Unused now (see above).
 * alongM : optional real along-section metres, 1:1 with ``columns``. Unused now (see above).
 *
 * Returns
 * -------
 * Set<string>
 *     Always empty — no outer-column unit pinches; the overlay bands them all to the edge.
 */
export function outerColumnZeroTieLayerIds(
  _columns: readonly PartitionColumn[],
  _edges: readonly CorrelationEdge[] = [],
  _alongM?: readonly number[],
): Set<string> {
  // Owner 2026-09-07: the outermost column always bands to the section edge — nothing pinches.
  return new Set<string>()
}
