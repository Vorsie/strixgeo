/**
 * partitionFillV2/lensEnclosure.ts — the ENCLOSING MATRIX of a corr-0 LENS, read from the
 * terminating unit's OWN column (owner ruling 8n(b), 2026-07-18, on x=646.74).
 *
 * RULING 8n(b) (owner, verbatim on the col18 thin-lens stack at x=646.74): asked whether the
 * sand filling past col18's thin SILT/VEEN lens apexes — where the FACING col19 has its big ZAND
 * spanning those elevations — was correct facing-fill, the owner ruled: "oh no that is wrong, it
 * should be silt and veen in the lens and there is no sand adjacency."
 *
 * A corr-0 LENS pinches INSIDE its enclosing matrix (ruling 8g — the enclosing formation flows
 * AROUND the lens as a DETOUR and reconnects; the two open ends of the wrap are the SAME litho).
 * The lens interior carries the lens's OWN litho to its apex; the space PAST the apex belongs to
 * that enclosing matrix — read from the lens's OWN column, NEVER sampled from the far facing
 * column at the lens mid-elevation (the s30 ``facingMatrixLabel(facing, midElev)`` sample, which
 * produced the phantom "sand lens" the owner flagged: col19 is 78 m away with ZAND at those
 * elevations).
 *
 * THE WALK (ruling 8g "same litho on both open ends"). A minority STACK — col18's SILT over VEEN,
 * both corr-0, KLEI above and below — pinches as ONE stack: each lens's interior is its own litho,
 * the wrap past the apexes is the shared enclosing matrix. So the matrix lookup must walk PAST
 * adjacent minorities (the sibling lens, and any intervening thin unit) to the formation that
 * appears NEAREST on BOTH the up-walk and the down-walk — the litho that wraps around the whole
 * pinch. When the up-walk and down-walk share NO formation (no common enclosure — a genuine rule
 * gap the 8g "same litho" invariant does not resolve) this returns ``null`` and the caller must
 * ASK-FIRST rather than invent a preference.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type LensLabel } from './emitLenses'
import { type ColumnGeom } from './sectionGeom'

/**
 * The enclosing-matrix label of the corr-0 lens at ``col.units[ui]`` — the formation that wraps
 * around the pinch (ruling 8n(b)/8g), read from the lens's OWN column.
 *
 * Walks the own-column stack OUTWARD from ``ui`` (up and down), collecting the ordered sequence of
 * neighbour formations on each side, and returns the formation that appears NEAREST (smallest
 * combined up+down rank) in BOTH sequences — the shared enclosure that flows around the lens (and
 * around any sibling minority in the same pinching stack). Both flood wedges of the lens carry this
 * single label (the wrap is one litho by the 8g closed-shape invariant).
 *
 * Parameters
 * ----------
 * col : ColumnGeom
 *     The terminating (lens) column — its picked stack is ground truth (ruling 8k).
 * ui : number
 *     The lensing unit's index on ``col``.
 *
 * Returns
 * -------
 * LensLabel | null
 *     The enclosing matrix (formation + a representative bodyId of that formation on this column),
 *     or ``null`` when the up-walk and down-walk share NO formation — the ASK-FIRST rule gap.
 */
export function lensEnclosingMatrix(col: ColumnGeom, ui: number): LensLabel | null {
  const units = col.units
  // Up-walk: neighbours above ui, nearest first (ui-1, ui-2, ...). Down-walk: below (ui+1, ...).
  // Rank = distance from the lens; the nearest formation present in BOTH walks is the wrap.
  const upRank = new Map<string, number>()
  const upUnit = new Map<string, ColumnGeom['units'][number]>()
  for (let k = ui - 1, r = 1; k >= 0; k--, r++) {
    const f = units[k].formationId
    if (!upRank.has(f)) {
      upRank.set(f, r)
      upUnit.set(f, units[k])
    }
  }
  let best: string | null = null
  let bestRank = Infinity
  let bestUnit: ColumnGeom['units'][number] | null = null
  for (let k = ui + 1, r = 1; k < units.length; k++, r++) {
    const f = units[k].formationId
    const up = upRank.get(f)
    if (up === undefined) continue // not shared — this down-formation has no up-side match
    const combined = up + r
    if (combined < bestRank) {
      bestRank = combined
      best = f
      // Prefer the below-unit's body (v1 ``belowLith ?? aboveLith``); the two same-formation
      // enclosure halves routinely carry different bodyIds — the post-fill 8j merge welds them,
      // so either representative is fine (the LABEL formation is what the fill reads).
      bestUnit = units[k]
    }
  }
  if (best === null || bestUnit === null) return null
  return { formationId: best, bodyId: bestUnit.bodyId }
}
