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
 * The model (per-body SEGMENTS, lens-merged)
 * ------------------------------------------
 * A body can carry SEVERAL members on one column. Whether those members fuse
 * into one envelope or stay separate depends on WHAT splits them (owner
 * directive 2026-06-05):
 *
 *   - Split by a LENS (a body absent on the neighbour column → it pinches out):
 *     the members fuse into ONE envelope. This is the merged-sand case — a sand
 *     broken only by thin clay/silt lenses is one continuous sand band, the
 *     lenses cut out on top.
 *   - Split by a MATCHED band (a body present on the neighbour too, e.g. a VEEN
 *     that runs through both columns): the members STAY SEPARATE envelopes. The
 *     matched band is drawn between them; fusing across it produced a crossing
 *     artifact — the band swept over the matched band (dogfeed 2026-06-05
 *     "weird polygon").
 *
 * So each column collapses into an ordered list of SEGMENTS (a body may appear
 * more than once). Then:
 *
 *   - A segment matched on BOTH columns fills one continuous BAND quad from its
 *     left envelope to its right envelope.
 *   - A left-only segment (a lens / pinch-out, or the orphan half of a
 *     matched-band split) draws a PINCH triangle wedging RIGHT to a single apex
 *     at its morphed centre depth; a right-only segment wedges LEFT. Drawn ON
 *     TOP of the bands, so the lens is "cut out" of the continuous matrix.
 *
 * Segments of the SAME body are paired left↔right by MORPHED-depth overlap (the
 * segment whose mapped depth range overlaps a partner bands; an orphan with no
 * overlapping partner pinches). The morph itself is the piecewise-linear depth
 * map L-depth → R-depth built from the UNAMBIGUOUS matches (bodies with exactly
 * one segment on each side) plus surface 0↔0 and the column floors. Bands are
 * emitted largest-envelope-first then pinches last, so a nested band / lens
 * always paints over the body that encloses it.
 *
 * Pure module (no React, no screen transforms) in world coordinates
 * (depth + mTAW elevation) so the geometry is unit-testable; the overlay maps a
 * quad to screen space + column edges.
 */

const EPS = 1e-9

/** One unit (accepted litho layer) on a column, in depth-below-surface metres. */
export interface MorphUnit {
  topDepthM: number
  baseDepthM: number
  /** Drives the fill colour (lithology). */
  formationId: string
  /** Resolver-stamped body — members sharing a body merge into one envelope. */
  bodyId: string | null
}

/** One column's placement + its gap-free unit stack (sorted by ``topDepthM``). */
export interface MorphColumn {
  investigationId: string
  /** Surface elevation (mTAW) — converts depth → absolute elevation. */
  surfaceElevM: number
  units: readonly MorphUnit[]
}

/** One filled shape: a band quad (matched) or a pinch triangle (lens). */
export interface MorphQuad {
  formationId: string
  bodyId: string | null
  /** ``band`` = matched both sides (quad); ``pinch`` = single-column lens. */
  kind: 'band' | 'pinch'
  /**
   * Pinch only: which column carries the full-width SOURCE edge. ``'left'`` =
   * body on the left column, wedges toward the right (apex near the right
   * column). ``'right'`` = body on the right column, wedges toward the left.
   * A lens absent on BOTH neighbours is emitted once per adjacent gap, so it
   * pinches symmetrically (a handle on each side).
   */
  sourceSide?: 'left' | 'right'
  /**
   * Absolute elevation (mTAW) of the corners. For a ``'left'`` pinch the source
   * is ``left*`` and the apex is ``rightTopElev == rightBaseElev``; for a
   * ``'right'`` pinch the source is ``right*`` and the apex is
   * ``leftTopElev == leftBaseElev``.
   */
  leftTopElev: number
  leftBaseElev: number
  rightTopElev: number
  rightBaseElev: number
}

/** One body SEGMENT's vertical envelope on a column (depth-below-surface m). */
interface BodySegment {
  /** ``bodyId`` (or a synthetic per-unit key for body-less units). */
  key: string
  bodyId: string | null
  formationId: string
  topDepth: number
  baseDepth: number
}

interface Anchor {
  /** Depth (m) on the left column. */
  l: number
  /** Depth (m) on the right column. */
  r: number
}

/** The set of real body ids present on a column (drives the lens-vs-matched test). */
function bodyKeySet(col: MorphColumn): Set<string> {
  const s = new Set<string>()
  for (const u of col.units) if (u.bodyId != null) s.add(u.bodyId)
  return s
}

/**
 * Collapse a column into ordered body SEGMENTS, fusing a body's members across
 * LENS gaps only.
 *
 * Walks the gap-free stack top→bottom. A body's members extend its open segment
 * UNLESS a MATCHED band (a unit whose body is present on the other column too)
 * intervenes: a matched unit seals every OTHER open body, so a member appearing
 * below it starts a NEW segment — the matched band will be drawn between the two
 * (never swept across). The matched unit's own body stays open so its members
 * still fuse across lens gaps.
 *
 * Parameters
 * ----------
 * col : MorphColumn
 *     The column whose units to segment.
 * otherKeys : Set<string>
 *     Body ids present on the OTHER column of the gap — a unit whose body is in
 *     this set is a matched band (a barrier), not a lens.
 *
 * Returns
 * -------
 * BodySegment[]
 *     Segments in top→bottom order; a body may appear more than once.
 */
function buildSegments(col: MorphColumn, otherKeys: Set<string>): BodySegment[] {
  const segs: BodySegment[] = []
  // key → index of that body's currently-open (extendable) segment.
  const open = new Map<string, number>()
  col.units.forEach((u, i) => {
    const key = u.bodyId ?? `__u${i}`
    const idx = open.get(key)
    if (idx !== undefined) {
      segs[idx].topDepth = Math.min(segs[idx].topDepth, u.topDepthM)
      segs[idx].baseDepth = Math.max(segs[idx].baseDepth, u.baseDepthM)
    } else {
      segs.push({
        key,
        bodyId: u.bodyId,
        formationId: u.formationId,
        topDepth: u.topDepthM,
        baseDepth: u.baseDepthM,
      })
      open.set(key, segs.length - 1)
    }
    // A unit present on the OTHER column is a matched band: it separates above
    // from below, so seal every OTHER open body. A reappearance below then
    // starts a new segment (a separate band), never merging across it.
    if (u.bodyId != null && otherKeys.has(u.bodyId)) {
      for (const k of [...open.keys()]) if (k !== key) open.delete(k)
    }
  })
  return segs
}

/** Count how many segments each body key has in a column's segment list. */
function countByKey(segs: BodySegment[]): Map<string, number> {
  const c = new Map<string, number>()
  for (const s of segs) c.set(s.key, (c.get(s.key) ?? 0) + 1)
  return c
}

/**
 * Build the monotonic anchor list (left-depth ↔ right-depth) from the
 * UNAMBIGUOUS matches — bodies with exactly one segment on each side — plus the
 * surface (0↔0) and the column floors. Multi-segment bodies are placed against
 * this morph (overlap pairing), so they don't need to seed it. Sorted by
 * left-depth, de-duplicated, clamped non-decreasing so a crossing correlation
 * can't invert a quad.
 */
function buildAnchorsFromSegments(
  leftSegs: BodySegment[],
  rightSegs: BodySegment[],
  leftCount: Map<string, number>,
  rightCount: Map<string, number>,
  leftFloor: number,
  rightFloor: number,
): Anchor[] {
  const rightByKey = new Map<string, BodySegment>()
  for (const re of rightSegs) if (rightCount.get(re.key) === 1) rightByKey.set(re.key, re)

  const anchors: Anchor[] = [{ l: 0, r: 0 }]
  for (const le of leftSegs) {
    if (leftCount.get(le.key) !== 1) continue
    const re = rightByKey.get(le.key)
    if (!re) continue
    anchors.push({ l: le.topDepth, r: re.topDepth })
    anchors.push({ l: le.baseDepth, r: re.baseDepth })
  }
  anchors.push({ l: leftFloor, r: rightFloor })

  anchors.sort((a, b) => a.l - b.l)
  const dedup: Anchor[] = []
  for (const a of anchors) {
    const prev = dedup[dedup.length - 1]
    if (prev && Math.abs(prev.l - a.l) < EPS) prev.r = Math.max(prev.r, a.r)
    else dedup.push({ ...a })
  }
  for (let i = 1; i < dedup.length; i += 1) {
    if (dedup[i].r < dedup[i - 1].r) dedup[i].r = dedup[i - 1].r
  }
  return dedup
}

/** Piecewise-linear depth morph: a left-column depth → its right-column depth. */
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
 *     Band quads (matched segments, largest envelope first) followed by pinch
 *     triangles (orphan segments, painted on top). Tiles the gap with no hole.
 *     Empty when the left column has no units.
 */
export function computeMorphFill(left: MorphColumn, right: MorphColumn): MorphQuad[] {
  if (left.units.length === 0) return []

  const leftKeys = bodyKeySet(left)
  const rightKeys = bodyKeySet(right)
  const leftSegs = buildSegments(left, rightKeys)
  const rightSegs = buildSegments(right, leftKeys)

  const leftFloor = left.units[left.units.length - 1].baseDepthM
  const rightFloor = right.units.length ? right.units[right.units.length - 1].baseDepthM : 0

  const leftCount = countByKey(leftSegs)
  const rightCount = countByKey(rightSegs)
  const anchors = buildAnchorsFromSegments(
    leftSegs,
    rightSegs,
    leftCount,
    rightCount,
    leftFloor,
    rightFloor,
  )
  // Reverse anchors (right-depth → left-depth) for right-only pinch apexes.
  const reverseAnchors = buildReverseAnchors(anchors)

  // Pair same-body segments by MORPHED-depth overlap: the best-overlapping pair
  // wins (global greedy), each segment used once. An unpaired segment pinches.
  const pairs: { li: number; ri: number; ov: number }[] = []
  leftSegs.forEach((le, li) => {
    const mTop = morphDepth(le.topDepth, anchors)
    const mBase = morphDepth(le.baseDepth, anchors)
    rightSegs.forEach((re, ri) => {
      if (re.key !== le.key) return
      const ov = Math.min(mBase, re.baseDepth) - Math.max(mTop, re.topDepth)
      if (ov > EPS) pairs.push({ li, ri, ov })
    })
  })
  pairs.sort((a, b) => b.ov - a.ov)
  const matchOf = new Map<number, number>() // left index → right index
  const rightUsed = new Set<number>()
  for (const p of pairs) {
    if (matchOf.has(p.li) || rightUsed.has(p.ri)) continue
    matchOf.set(p.li, p.ri)
    rightUsed.add(p.ri)
  }

  const bands: MorphQuad[] = []
  const pinches: MorphQuad[] = []

  leftSegs.forEach((le, li) => {
    const ri = matchOf.get(li)
    if (ri !== undefined) {
      const re = rightSegs[ri]
      bands.push({
        formationId: le.formationId,
        bodyId: le.bodyId,
        kind: 'band',
        leftTopElev: left.surfaceElevM - le.topDepth,
        leftBaseElev: left.surfaceElevM - le.baseDepth,
        rightTopElev: right.surfaceElevM - re.topDepth,
        rightBaseElev: right.surfaceElevM - re.baseDepth,
      })
    } else {
      // Left-only segment → triangle wedging RIGHT to a single apex at the
      // morphed centre (its proportional depth inside the enclosing matrix).
      const apexDepth = (morphDepth(le.topDepth, anchors) + morphDepth(le.baseDepth, anchors)) / 2
      const apexElev = right.surfaceElevM - apexDepth
      pinches.push({
        formationId: le.formationId,
        bodyId: le.bodyId,
        kind: 'pinch',
        sourceSide: 'left',
        leftTopElev: left.surfaceElevM - le.topDepth,
        leftBaseElev: left.surfaceElevM - le.baseDepth,
        rightTopElev: apexElev,
        rightBaseElev: apexElev,
      })
    }
  })

  // Right-only segments (absent on the left) → a triangle wedging LEFT, so a
  // lens absent on its LEFT neighbour still renders + is shapeable.
  rightSegs.forEach((re, ri) => {
    if (rightUsed.has(ri)) return
    const apexDepth =
      (morphDepth(re.topDepth, reverseAnchors) + morphDepth(re.baseDepth, reverseAnchors)) / 2
    const apexElev = left.surfaceElevM - apexDepth
    pinches.push({
      formationId: re.formationId,
      bodyId: re.bodyId,
      kind: 'pinch',
      sourceSide: 'right',
      leftTopElev: apexElev,
      leftBaseElev: apexElev,
      rightTopElev: right.surfaceElevM - re.topDepth,
      rightBaseElev: right.surfaceElevM - re.baseDepth,
    })
  })

  // Largest envelope first so a nested band / lens paints over its enclosing
  // body; pinches last so a lens is always cut out of the matrix on top.
  bands.sort(
    (a, b) =>
      Math.abs(b.leftTopElev - b.leftBaseElev) - Math.abs(a.leftTopElev - a.leftBaseElev),
  )
  return [...bands, ...pinches]
}

/** Swap + re-sort anchors so the morph can map a right-depth back to a left-depth. */
function buildReverseAnchors(anchors: Anchor[]): Anchor[] {
  const swapped = anchors.map((a) => ({ l: a.r, r: a.l }))
  swapped.sort((a, b) => a.l - b.l)
  const dedup: Anchor[] = []
  for (const a of swapped) {
    const prev = dedup[dedup.length - 1]
    if (prev && Math.abs(prev.l - a.l) < EPS) prev.r = Math.max(prev.r, a.r)
    else dedup.push({ ...a })
  }
  for (let i = 1; i < dedup.length; i += 1) {
    if (dedup[i].r < dedup[i - 1].r) dedup[i].r = dedup[i - 1].r
  }
  return dedup
}
