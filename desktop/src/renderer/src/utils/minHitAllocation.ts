/**
 * Minimum hit-target allocation for a stack of contiguous bands (debt #158).
 *
 * A thin band's clickable rect is its visual rect — at real zoom that can be a
 * handful of pixels, and the owner mis-clicked one band low twice in one week
 * (2026-08-04/05, the CLAY-SF → SILT chase). The fix is not to grow the visual
 * band but to let a thin band BORROW hit space from fat neighbours: each thin
 * band may extend its invisible capture strip into the adjacent band's slack,
 * where slack is whatever the neighbour has above the minimum itself.
 *
 * Pure module: no I/O, no screen state. The caller renders the returned
 * expansions as invisible strips ON TOP of the visible bands, so a fat band's
 * own surface is untouched everywhere except the donated sliver.
 */

/** One band's vertical extent in screen px (``top < bottom``). */
export interface BandExtent {
  top: number
  bottom: number
}

/** How far a band's hit surface may extend beyond its visual rect (px). */
export interface HitExpansion {
  /** Extra capture ABOVE the band's visual top (grows into the neighbour above). */
  growTop: number
  /** Extra capture BELOW the band's visual bottom (grows into the neighbour below). */
  growBottom: number
}

/**
 * Allocate hit-target expansions for a contiguous, ordered band stack.
 *
 * Rules, in the order they bind:
 *  - a band at or above ``minPx`` gets no expansion (its surface is already
 *    comfortable, and growing it would shadow neighbours for no reason);
 *  - a thin band asks each side for half of its shortfall;
 *  - a neighbour donates at most its own slack ``(height − minPx) / 2`` per
 *    side, never going below ``minPx`` itself — and a neighbour that is thin
 *    donates nothing (two adjacent thin bands keep their visual boundary:
 *    there is no honest way to favour one over the other);
 *  - the stack's outer edges are hard walls (no growth past the first band's
 *    top or the last band's bottom — the space beyond belongs to other
 *    surfaces entirely).
 *
 * Parameters
 * ----------
 * bands : readonly BandExtent[]
 *     Contiguous ordered extents, ``bands[i].bottom === bands[i+1].top``
 *     (small gaps are tolerated; expansions never cross into a gap further
 *     than the neighbour's donated slack).
 * minPx : number
 *     The minimum comfortable hit height.
 *
 * Returns
 * -------
 * HitExpansion[]
 *     One entry per band, all zeros for bands already at the minimum.
 */
export function allocateMinHitExpansions(
  bands: readonly BandExtent[],
  minPx: number,
): HitExpansion[] {
  const out: HitExpansion[] = bands.map(() => ({ growTop: 0, growBottom: 0 }))
  for (let i = 0; i < bands.length; i++) {
    const h = bands[i].bottom - bands[i].top
    if (h >= minPx) continue
    const wantPerSide = (minPx - h) / 2
    const above = i > 0 ? bands[i - 1] : null
    const below = i + 1 < bands.length ? bands[i + 1] : null
    const slackAbove = above ? Math.max(0, (above.bottom - above.top - minPx) / 2) : 0
    const slackBelow = below ? Math.max(0, (below.bottom - below.top - minPx) / 2) : 0
    // A side with no donatable slack contributes nothing; the other side does
    // NOT compensate beyond its own slack (over-borrowing from one side would
    // put the expanded strip's centre off the band it belongs to).
    out[i].growTop = Math.min(wantPerSide, slackAbove)
    out[i].growBottom = Math.min(wantPerSide, slackBelow)
  }
  return out
}
