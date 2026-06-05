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
 * The model (per-BODY envelopes)
 * ------------------------------
 * A body can carry SEVERAL members on one column (a sand split by thin clay /
 * silt lenses is ONE sand body with 3 members — owner directive 2026-06-05:
 * "the big sand is one body"). So the fill works per BODY, not per unit:
 *
 *   - Each body's ENVELOPE on a column is ``[min member top, max member base]``.
 *   - A body present on BOTH columns (matched) fills one continuous BAND quad
 *     from its left envelope to its right envelope — the merged sand fills
 *     straight across, never "breaking up".
 *   - A body present on the left only (a lens / pinch-out) draws a PINCH
 *     triangle from its left envelope to a single apex on the right, at the
 *     depth the morph maps its centre to — i.e. it wedges out at its
 *     proportional depth inside the enclosing matrix. Drawn ON TOP of the
 *     bands, so the clay / silt lens is "cut out" of the continuous sand.
 *
 * The morph itself is the piecewise-linear depth map L-depth → R-depth built
 * from the matched bodies' envelope boundaries (plus surface 0↔0 and the column
 * floors). Bands are emitted largest-envelope-first then pinches last, so a
 * nested band / lens always paints over the body that encloses it. The bands
 * tile the gap surface-to-floor with no hole; the pinches refine it.
 *
 * Pure module (no React, no screen transforms) in world coordinates
 * (depth + mTAW elevation) so the geometry is unit-testable; the overlay maps a
 * quad to screen space + column edges.
 *
 * Scope note (v1): computed L→R, so a body present ONLY on the right is shown by
 * its claimed cap in ``BodyExtentOverlay``. Bidirectional interfingering stays a
 * refinement.
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
   * Pinch only: where the apex sits horizontally across the gap, as a fraction
   * ``0`` (left column) → ``1`` (right column). Default ``1`` for a left pinch
   * (apex at the right column) and ``0`` for a right pinch. When a left and a
   * right pinch overlap in elevation they share a fraction strictly inside the
   * gap so they meet at a boundary instead of crossing.
   */
  apexAlongFraction?: number
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

/** A body's vertical envelope on one column (depth-below-surface metres). */
interface BodyEnvelope {
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

/**
 * Collapse a column's units into one envelope per body (members merged).
 *
 * A unit with no ``bodyId`` becomes its own single-unit envelope so it still
 * renders (defensive — accepted layers always carry a body in practice).
 */
function envelopesByBody(col: MorphColumn): Map<string, BodyEnvelope> {
  const m = new Map<string, BodyEnvelope>()
  col.units.forEach((u, i) => {
    const key = u.bodyId ?? `__u${i}`
    const e = m.get(key)
    if (e) {
      e.topDepth = Math.min(e.topDepth, u.topDepthM)
      e.baseDepth = Math.max(e.baseDepth, u.baseDepthM)
    } else {
      m.set(key, {
        key,
        bodyId: u.bodyId,
        formationId: u.formationId,
        topDepth: u.topDepthM,
        baseDepth: u.baseDepthM,
      })
    }
  })
  return m
}

/**
 * Build the monotonic anchor list (left-depth ↔ right-depth) from the matched
 * bodies' ENVELOPE boundaries, plus the surface (0↔0) and the column floors.
 * Sorted by left-depth, de-duplicated, clamped to a non-decreasing right-depth
 * so a crossing correlation can't invert a quad.
 */
function buildAnchors(
  leftEnv: Map<string, BodyEnvelope>,
  rightEnv: Map<string, BodyEnvelope>,
  leftFloor: number,
  rightFloor: number,
): Anchor[] {
  const anchors: Anchor[] = [{ l: 0, r: 0 }]
  for (const le of leftEnv.values()) {
    const re = rightEnv.get(le.key)
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
 *     Band quads (matched bodies, largest envelope first) followed by pinch
 *     triangles (left-only lenses, painted on top). Tiles the gap with no hole.
 *     Empty when the left column has no units.
 */
export function computeMorphFill(left: MorphColumn, right: MorphColumn): MorphQuad[] {
  if (left.units.length === 0) return []

  const leftEnv = envelopesByBody(left)
  const rightEnv = envelopesByBody(right)
  const leftFloor = left.units[left.units.length - 1].baseDepthM
  const rightFloor = right.units.length ? right.units[right.units.length - 1].baseDepthM : 0
  const anchors = buildAnchors(leftEnv, rightEnv, leftFloor, rightFloor)

  // Reverse anchors (right-depth → left-depth) for R-only pinch apexes.
  const reverseAnchors = buildReverseAnchors(anchors)

  const bands: MorphQuad[] = []
  const pinches: MorphQuad[] = []

  for (const le of leftEnv.values()) {
    const re = rightEnv.get(le.key)
    if (re) {
      // Matched body → one continuous band from envelope to envelope.
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
      // Left-only body → triangle wedging RIGHT to a single apex at the morphed
      // centre (its proportional depth inside the enclosing matrix).
      const apexDepth = (morphDepth(le.topDepth, anchors) + morphDepth(le.baseDepth, anchors)) / 2
      const apexElev = right.surfaceElevM - apexDepth
      pinches.push({
        formationId: le.formationId,
        bodyId: le.bodyId,
        kind: 'pinch',
        sourceSide: 'left',
        apexAlongFraction: 1,
        leftTopElev: left.surfaceElevM - le.topDepth,
        leftBaseElev: left.surfaceElevM - le.baseDepth,
        rightTopElev: apexElev,
        rightBaseElev: apexElev,
      })
    }
  }

  // Right-only bodies (present on the right column, absent on the left) → a
  // triangle wedging LEFT. This is what makes a lens absent on its LEFT
  // neighbour render + be shapeable, not only a right-wedging one.
  for (const re of rightEnv.values()) {
    if (leftEnv.has(re.key)) continue
    const apexDepth =
      (morphDepth(re.topDepth, reverseAnchors) + morphDepth(re.baseDepth, reverseAnchors)) / 2
    const apexElev = left.surfaceElevM - apexDepth
    pinches.push({
      formationId: re.formationId,
      bodyId: re.bodyId,
      kind: 'pinch',
      sourceSide: 'right',
      apexAlongFraction: 0,
      leftTopElev: apexElev,
      leftBaseElev: apexElev,
      rightTopElev: right.surfaceElevM - re.topDepth,
      rightBaseElev: right.surfaceElevM - re.baseDepth,
    })
  }

  // Where a left-wedging pinch and a right-wedging pinch overlap in elevation
  // they would BOTH span the full gap and cross (dogfeed 2026-06-05: "2 pinch
  // outs ... can't overlap, ideally fully adjacent"). Make each such pair meet
  // at a shared boundary — the thicker lithology keeps the larger share of the
  // gap — so the lithologies sit side by side instead of overlapping.
  const rights = pinches.filter((p) => p.sourceSide === 'right')
  const pairedRight = new Set<MorphQuad>()
  for (const L of pinches) {
    if (L.sourceSide !== 'left') continue
    const lLo = Math.min(L.leftTopElev, L.leftBaseElev)
    const lHi = Math.max(L.leftTopElev, L.leftBaseElev)
    for (const R of rights) {
      if (pairedRight.has(R)) continue
      const rLo = Math.min(R.rightTopElev, R.rightBaseElev)
      const rHi = Math.max(R.rightTopElev, R.rightBaseElev)
      if (Math.min(lHi, rHi) - Math.max(lLo, rLo) <= EPS) continue // no overlap
      const tL = lHi - lLo
      const tR = rHi - rLo
      const f = tL + tR > EPS ? tL / (tL + tR) : 0.5
      L.apexAlongFraction = f
      R.apexAlongFraction = f
      pairedRight.add(R)
      break
    }
  }

  // Largest envelope first so a nested band / lens paints over its enclosing
  // body; pinches last so a lens is always cut out of the matrix on top.
  bands.sort((a, b) => Math.abs(b.leftTopElev - b.leftBaseElev) - Math.abs(a.leftTopElev - a.leftBaseElev))
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
