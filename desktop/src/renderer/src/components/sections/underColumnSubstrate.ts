/**
 * Component-side under-column substrate for the section fill (S60 Stage A).
 *
 * Forked VERBATIM from the frozen v1 helper ``computeUnderColumnSubstrate``
 * (``utils/sectionPartition/sectionRegion.ts`` — READ-ONLY during the
 * partition-engine-v2 campaign) with EXACTLY ONE delta, implementing the S60
 * owner rule:
 *
 *   "Below a column's TD, the space belongs to the PARTITION — the gap
 *    regions' fill must run continuously under the glyph."
 *
 * THE DELTA — the v1 ``stackAtEdge`` guard rejected any edge slice whose TOP
 * sits above the column's TD (``if (hi > tdElev + EPS) continue``, added for
 * the 2026-07-08 "floating silt strip" dogfeed). The v2 engine emits a
 * column's own bottom unit as ONE region running continuously THROUGH the TD
 * (no polygon split at the TD line — measured on CS1 B2: ZAND slice
 * [−7.55..4.25] at the right edge, TD −4.45), so the v1 guard threw the sand
 * away and the deeper clay was extended up to the TD — the B2 phantom "clay
 * directly under the sand" block. Here every slice is CLIPPED to the below-TD
 * band instead (``top = min(hi, tdElev)``, which the v1 code already did for
 * kept slices) and kept when the remainder is meaningful — so the substrate
 * mirrors exactly what the partition carries below the TD, per the rule.
 *
 * Everything else (void closure by extending the OVERLYING formation down,
 * same-formation merging, deep→deep sloping, flat fallback) is byte-identical
 * to v1 — the four frozen v1 unit cases pass unchanged through this fork
 * (their slice tops sit AT the TD, so the deleted rejection never fired).
 *
 * RECONCILIATION TRIGGER: when the v2 cutover unfreezes ``utils/partitionFill``,
 * fold this clip-only guard back into ``computeUnderColumnSubstrate`` and
 * delete this fork (single source of truth).
 */

import type { PartitionColumn, SectionRegion, UnderColumnFill, UnderColumnQuad } from '../../utils/sectionPartition'
import { slicePolygonAtFraction } from '../../utils/sectionPartition/sectionRegion'

/** Elevation tolerance (m) — matches the v1 helper's local EPS. */
const EPS = 0.01

/**
 * Substrate fill for the column-width sliver BELOW each test's TD.
 *
 * Same contract as the v1 ``computeUnderColumnSubstrate`` (see the module
 * docstring for the single behavioural delta).
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The non-empty columns in along-section order — the SAME list passed to
 *     the section-fill engine (region ``gapIndex`` is relative to it).
 * regions : readonly SectionRegion[]
 *     The active engine's section-fill output for those columns.
 *
 * Returns
 * -------
 * UnderColumnFill[]
 *     One entry per column that has anything to fill below its TD.
 */
export function computeUnderColumnSubstrateForRender(
  columns: readonly PartitionColumn[],
  regions: readonly SectionRegion[],
): UnderColumnFill[] {
  const nCol = columns.length
  if (nCol < 2) return []

  /**
   * Contiguous matrix (non-lens) stack at one gap edge, below ``tdElev``.
   * Slices are CLIPPED to the below-TD band (S60 delta — see module doc);
   * lens spots are closed by extending the overlying formation downward.
   * Returns top→bottom with no vertical gap.
   */
  const stackAtEdge = (gapIdx: number, frac: number, tdElev: number) => {
    const segs: Array<{ lo: number; hi: number; formationId: string }> = []
    for (const r of regions) {
      if (r.gapIndex !== gapIdx || r.kind === 'lens') continue
      for (const [lo, hi] of slicePolygonAtFraction(r.polygon, frac)) {
        // S60 owner rule: the partition owns the sub-TD space, so a region
        // running continuously through the TD contributes its below-TD portion
        // (clip, don't reject). The v1 rejection of straddling slices is the
        // ONLY line removed from this fork.
        const top = Math.min(hi, tdElev)
        if (top - lo > EPS) segs.push({ lo, hi: top, formationId: r.formationId })
      }
    }
    segs.sort((a, b) => b.hi - a.hi)
    const out: Array<{ top: number; base: number; formationId: string }> = []
    let cursor = tdElev // top of the next band to place
    let aboveForm: string | null = null // formation of the band directly above the cursor
    for (const s of segs) {
      if (cursor - s.lo <= EPS) continue // already covered by a higher segment
      if (s.hi < cursor - EPS) {
        // A vertical VOID between the band above (cursor) and this segment's
        // top — fill it with the OVERLYING formation (extend the band ABOVE
        // downward), matching what the neighbours log there. Verbatim v1.
        out.push({ top: cursor, base: s.hi, formationId: aboveForm ?? s.formationId })
        cursor = s.hi
      }
      out.push({ top: cursor, base: s.lo, formationId: s.formationId })
      cursor = s.lo
      aboveForm = s.formationId
    }
    // Merge consecutive same-formation bands (verbatim v1).
    const merged: Array<{ top: number; base: number; formationId: string }> = []
    for (const b of out) {
      const last = merged[merged.length - 1]
      if (last && last.formationId === b.formationId && Math.abs(last.base - b.top) < EPS) {
        last.base = b.base
      } else {
        merged.push({ ...b })
      }
    }
    return merged
  }

  const out: UnderColumnFill[] = []
  for (let ci = 0; ci < nCol; ci++) {
    const col = columns[ci]
    if (col.units.length === 0) continue
    const tdElev = col.surfaceElevM - Math.max(...col.units.map((u) => u.baseDepthM))

    // Matrix stack at this column's LEFT edge (right edge of the left gap) and
    // RIGHT edge (left edge of the right gap) — verbatim v1 fractions.
    const leftStack = ci > 0 ? stackAtEdge(ci - 1, 0.9985, tdElev) : []
    const rightStack = ci < nCol - 1 ? stackAtEdge(ci, 0.0015, tdElev) : []

    const quads: UnderColumnQuad[] = []
    const sameStack =
      leftStack.length > 0 &&
      leftStack.length === rightStack.length &&
      leftStack.every((s, i) => s.formationId === rightStack[i].formationId)

    if (sameStack) {
      // Both edges carry the same band stack: SLOPE each band across.
      for (let i = 0; i < leftStack.length; i++) {
        const l = leftStack[i]
        const r = rightStack[i]
        quads.push({
          formationId: l.formationId,
          topLeftElev: l.top,
          baseLeftElev: l.base,
          topRightElev: r.top,
          baseRightElev: r.base,
        })
      }
    } else {
      // Stacks differ: FLAT fill from whichever side has data (verbatim v1).
      const s = rightStack.length > 0 ? rightStack : leftStack
      for (const seg of s) {
        quads.push({
          formationId: seg.formationId,
          topLeftElev: seg.top,
          baseLeftElev: seg.base,
          topRightElev: seg.top,
          baseRightElev: seg.base,
        })
      }
    }
    if (quads.length > 0) out.push({ columnIndex: ci, quads })
  }
  return out
}
