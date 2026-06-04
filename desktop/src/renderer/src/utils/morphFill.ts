/**
 * Continuous section fill via a depth MORPH between two adjacent columns.
 *
 * The problem this solves
 * -----------------------
 * The old per-body band fill only painted member-to-member trapezoids, so every
 * lateral pinch-out left a triangular HOLE bounded by the correlation lines —
 * the dark "blind spots" (dogfeed 2026-06-04). Owner directive: *"continuously
 * draw between 2 correlation bands from test to test, then cut out the
 * pinch-outs."*
 *
 * The model
 * ---------
 * For an adjacent column pair (left L, right R), both columns are segmented
 * gap-free top→bottom. A body present on BOTH columns gives a matched boundary
 * pair — an ANCHOR (left-depth ↔ right-depth). Surface (0↔0) and the column
 * floors are always anchors. The anchors define a piecewise-linear depth
 * ``morph`` L-depth → R-depth.
 *
 * Each LEFT unit is then drawn as one quad: its left edge is its own
 * ``[top, base]`` interval; its right edge is ``[morph(top), morph(base)]``.
 *   - A matched (through-going) body lands exactly on its R member → a wide
 *     trapezoid (the continuous band).
 *   - An UNMATCHED unit (present on L, absent on R) sits between two anchors
 *     whose right-depths converge, so ``morph(top)`` and ``morph(base)``
 *     collapse toward a single point → a triangle pinching out exactly where
 *     the bracketing correlation lines meet. The pinch-out is "cut out" of the
 *     surrounding matrix for free, with no arbitrary halfway midpoint.
 *
 * Because the left units are gap-free + sorted and the morph is monotonic
 * non-decreasing, the right edges are also gap-free + ordered: the quads tile
 * the whole gap with NO overlap and NO hole — surface to floor.
 *
 * This is a pure module (no React, no screen transforms) in world coordinates
 * (depth + mTAW elevation) so the geometry is unit-testable; the overlay maps a
 * quad to screen space + column edges.
 *
 * Scope note (v1): the morph is computed L→R and draws the LEFT column's units,
 * so a unit present ONLY on the right (an R-only lens) is not drawn here — it is
 * shown by its claimed cap in ``BodyExtentOverlay`` on top. Bidirectional
 * interfingering between control points stays a refinement.
 */

const EPS = 1e-9

/** One unit (accepted litho layer) on a column, in depth-below-surface metres. */
export interface MorphUnit {
  topDepthM: number
  baseDepthM: number
  /** Drives the fill colour (lithology). */
  formationId: string
  /** Resolver-stamped body — matched across columns to build anchors. */
  bodyId: string | null
}

/** One column's placement + its gap-free unit stack (sorted by ``topDepthM``). */
export interface MorphColumn {
  investigationId: string
  /** Surface elevation (mTAW) — converts depth → absolute elevation. */
  surfaceElevM: number
  units: readonly MorphUnit[]
}

/** One filled quad: left edge at column L, right edge at the morphed R position. */
export interface MorphQuad {
  formationId: string
  bodyId: string | null
  /** Absolute elevation (mTAW) of the quad corners. */
  leftTopElev: number
  leftBaseElev: number
  rightTopElev: number
  rightBaseElev: number
}

interface Anchor {
  /** Depth (m) on the left column. */
  l: number
  /** Depth (m) on the right column. */
  r: number
}

/**
 * Build the monotonic anchor list (left-depth ↔ right-depth) for the morph.
 *
 * Anchors are the surface (0↔0), every body present on BOTH columns (its member
 * top + base boundary pair), and the two column floors. Sorted by left-depth,
 * de-duplicated, and clamped to a non-decreasing right-depth so the morph never
 * inverts a quad when two correlations cross (a sane section should not, but a
 * loose one can).
 *
 * Parameters
 * ----------
 * left, right : MorphColumn
 *     The adjacent column pair.
 *
 * Returns
 * -------
 * Anchor[]
 *     At least the surface + floor anchors, sorted + monotonic.
 */
function buildAnchors(left: MorphColumn, right: MorphColumn): Anchor[] {
  const anchors: Anchor[] = [{ l: 0, r: 0 }]

  // First member per body on the right column (one member per column in
  // practice; first wins defensively if a body ever has two).
  const rightTopByBody = new Map<string, MorphUnit>()
  for (const u of right.units) {
    if (u.bodyId && !rightTopByBody.has(u.bodyId)) rightTopByBody.set(u.bodyId, u)
  }
  for (const lu of left.units) {
    if (!lu.bodyId) continue
    const ru = rightTopByBody.get(lu.bodyId)
    if (!ru) continue
    anchors.push({ l: lu.topDepthM, r: ru.topDepthM })
    anchors.push({ l: lu.baseDepthM, r: ru.baseDepthM })
  }

  const leftFloor = left.units.length ? left.units[left.units.length - 1].baseDepthM : 0
  const rightFloor = right.units.length ? right.units[right.units.length - 1].baseDepthM : 0
  anchors.push({ l: leftFloor, r: rightFloor })

  anchors.sort((a, b) => a.l - b.l)

  // De-duplicate by left-depth (keep the larger right-depth to stay monotonic).
  const dedup: Anchor[] = []
  for (const a of anchors) {
    const prev = dedup[dedup.length - 1]
    if (prev && Math.abs(prev.l - a.l) < EPS) {
      prev.r = Math.max(prev.r, a.r)
    } else {
      dedup.push({ ...a })
    }
  }
  // Enforce a non-decreasing right-depth so crossing correlations can't invert
  // a quad — an out-of-order anchor is pinned to its predecessor.
  for (let i = 1; i < dedup.length; i += 1) {
    if (dedup[i].r < dedup[i - 1].r) dedup[i].r = dedup[i - 1].r
  }
  return dedup
}

/**
 * Piecewise-linear depth morph: a left-column depth → its right-column depth.
 *
 * Parameters
 * ----------
 * d : number
 *     Depth (m) on the left column.
 * anchors : Anchor[]
 *     Monotonic anchors from :func:`buildAnchors`.
 *
 * Returns
 * -------
 * number
 *     The corresponding right-column depth (clamped to the anchor range).
 */
function morphDepth(d: number, anchors: Anchor[]): number {
  if (anchors.length === 0) return d
  if (d <= anchors[0].l) return anchors[0].r
  const last = anchors[anchors.length - 1]
  if (d >= last.l) return last.r
  for (let i = 1; i < anchors.length; i += 1) {
    if (d <= anchors[i].l) {
      const a = anchors[i - 1]
      const b = anchors[i]
      const span = b.l - a.l
      const t = span < EPS ? 0 : (d - a.l) / span
      return a.r + t * (b.r - a.r)
    }
  }
  return last.r
}

/**
 * Compute the continuous morph fill for one adjacent column gap.
 *
 * Parameters
 * ----------
 * left, right : MorphColumn
 *     The adjacent column pair. ``left.units`` must be gap-free + sorted by
 *     ``topDepthM`` (the resolver / segmenter guarantees this).
 *
 * Returns
 * -------
 * MorphQuad[]
 *     One quad per LEFT unit, ordered top→bottom, tiling the gap with no hole.
 *     Empty when the left column has no units.
 */
export function computeMorphFill(left: MorphColumn, right: MorphColumn): MorphQuad[] {
  if (left.units.length === 0) return []
  const anchors = buildAnchors(left, right)
  return left.units.map((u) => {
    const rTop = morphDepth(u.topDepthM, anchors)
    const rBase = morphDepth(u.baseDepthM, anchors)
    return {
      formationId: u.formationId,
      bodyId: u.bodyId,
      leftTopElev: left.surfaceElevM - u.topDepthM,
      leftBaseElev: left.surfaceElevM - u.baseDepthM,
      rightTopElev: right.surfaceElevM - rTop,
      rightBaseElev: right.surfaceElevM - rBase,
    }
  })
}
