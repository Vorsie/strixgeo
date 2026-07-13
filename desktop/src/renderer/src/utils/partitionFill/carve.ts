// partitionFill/carve.ts — extracted verbatim from partitionFill.ts
// (debt #201 round 2). See index.ts for the module-level doc.
import { ifaceElev } from './polygonBuilders'
import { EPS, type Interface, type PartitionPoint, type PartitionRegion, type PinchUnit } from './types'

// Overlay carve — turn lens/onlap overlays into a TRUE partition
// ---------------------------------------------------------------------------

/** Fraction tolerance for "this vertex sits on column edge 0 or 1". */
export const FRAC_EPS = 1e-6
/** Elevation tolerance when testing whether a matrix edge-span contains an overlay. */
export const SPAN_EPS = 1e-6

/**
 * A notch to cut into a matrix's column edge. ``ob``/``ot`` are the lower/upper
 * elevations where the notch meets the column edge; ``chain`` is the overlay's
 * interior boundary between them (ordered low → high), which is a single apex for
 * a fully-enclosed lens or a seam-riding chain for a straddle lens (owner's
 * "rest on the clay" rule — the lens base follows the sloping body beneath it
 * rather than crossing into it).
 */
export interface OverlayNotch {
  /** Lower elevation (mTAW) where the notch meets the column edge. */
  ob: number
  /** Upper elevation (mTAW) where the notch meets the column edge. */
  ot: number
  /** Interior boundary points between ``ob`` and ``ot`` (ordered low → high). */
  chain: PartitionPoint[]
}

/** Elevations of a polygon's vertices that sit on column edge ``side`` (0 or 1). */
export function edgeElevations(poly: PartitionPoint[], side: 0 | 1): number[] {
  return poly
    .filter((p) => Math.abs(p.fraction - side) < FRAC_EPS)
    .map((p) => p.elevation)
}

/** Signed area × 2 of a ring in (fraction, elevation) space (> 0 = CCW). */
export function signedArea2(poly: readonly PartitionPoint[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return s
}

/**
 * Clip a subject polygon to a CONVEX clip polygon (Sutherland-Hodgman) in
 * (fraction, elevation) space.
 *
 * Used to make an overlay (lens/onlap) "rest on" its enclosing matrix: the part
 * of the overlay that would stick out past a matrix edge is folded onto that
 * edge, so the overlay never crosses into a neighbouring body (owner's Solution
 * 2). A fully-enclosed overlay (every vertex already inside the matrix) is
 * returned unchanged.
 *
 * Parameters
 * ----------
 * subject : PartitionPoint[]
 *     The overlay ring to clip.
 * clip : PartitionPoint[]
 *     The convex matrix ring to clip against.
 *
 * Returns
 * -------
 * PartitionPoint[]
 *     The clipped ring (possibly empty if subject and clip are disjoint).
 */
export function clipToConvex(subject: PartitionPoint[], clip: PartitionPoint[]): PartitionPoint[] {
  const orient = signedArea2(clip) >= 0 ? 1 : -1
  const m = clip.length
  let output = subject.slice()
  for (let e = 0; e < m && output.length > 0; e++) {
    const c1 = clip[e]
    const c2 = clip[(e + 1) % m]
    const dx = c2.fraction - c1.fraction
    const dy = c2.elevation - c1.elevation
    // Left-test L(p) = (c2−c1) × (p−c1): > 0 = left of the directed edge. The
    // interior is left for a CCW ring, right for CW, so inside ⇔ orient·L ≥ 0.
    const L = (p: PartitionPoint): number =>
      dx * (p.elevation - c1.elevation) - dy * (p.fraction - c1.fraction)
    const intersect = (a: PartitionPoint, b: PartitionPoint): PartitionPoint => {
      const la = L(a)
      const lb = L(b)
      const t = Math.abs(la - lb) < 1e-12 ? 0 : la / (la - lb)
      return {
        fraction: a.fraction + t * (b.fraction - a.fraction),
        elevation: a.elevation + t * (b.elevation - a.elevation),
      }
    }
    const input = output
    output = []
    for (let i = 0; i < input.length; i++) {
      const a = input[i]
      const b = input[(i + 1) % input.length]
      const aIn = orient * L(a) >= -SPAN_EPS
      const bIn = orient * L(b) >= -SPAN_EPS
      if (aIn) {
        output.push(a)
        if (!bIn) output.push(intersect(a, b))
      } else if (bIn) {
        output.push(intersect(a, b))
      }
    }
  }
  // Drop consecutive duplicate vertices (clipping along an existing edge emits
  // coincident points) so downstream edge-vertex counting stays exact.
  return dedupeRing(output)
}

/** Remove consecutive (and wrap-around) near-duplicate vertices from a ring. */
export function dedupeRing(poly: PartitionPoint[]): PartitionPoint[] {
  const out: PartitionPoint[] = []
  for (const p of poly) {
    const last = out[out.length - 1]
    if (
      last &&
      Math.abs(last.fraction - p.fraction) < FRAC_EPS &&
      Math.abs(last.elevation - p.elevation) < SPAN_EPS
    ) {
      continue
    }
    out.push(p)
  }
  if (
    out.length > 1 &&
    Math.abs(out[0].fraction - out[out.length - 1].fraction) < FRAC_EPS &&
    Math.abs(out[0].elevation - out[out.length - 1].elevation) < SPAN_EPS
  ) {
    out.pop()
  }
  return out
}

/**
 * Extract the column-edge notch of a clipped overlay: where it meets edge
 * ``side`` (``ob``/``ot``) and the interior chain between (ordered low → high).
 *
 * The clipped overlay has exactly two vertices on the column edge (its base) and
 * one or more interior vertices (apex, or seam-riding chain). Returns ``null`` if
 * the shape is degenerate (fewer than two edge vertices) so the caller can skip.
 */
export function notchFromClipped(clipped: PartitionPoint[], side: 0 | 1): OverlayNotch | null {
  const n = clipped.length
  const onEdge = (p: PartitionPoint): boolean => Math.abs(p.fraction - side) < FRAC_EPS
  const edgeIdx: number[] = []
  for (let i = 0; i < n; i++) if (onEdge(clipped[i])) edgeIdx.push(i)
  if (edgeIdx.length !== 2) return null
  const [i, j] = edgeIdx
  const ob = Math.min(clipped[i].elevation, clipped[j].elevation)
  const ot = Math.max(clipped[i].elevation, clipped[j].elevation)
  // The two ring arcs between the edge vertices: one runs along the column edge
  // (no interior vertices), the other carries the interior boundary.
  const arc = (from: number, to: number): PartitionPoint[] => {
    const r: PartitionPoint[] = []
    for (let k = (from + 1) % n; k !== to; k = (k + 1) % n) r.push(clipped[k])
    return r
  }
  const arcA = arc(i, j) // i → j
  const arcB = arc(j, i) // j → i
  const hasInterior = (a: PartitionPoint[]): boolean => a.some((p) => !onEdge(p))
  let chain: PartitionPoint[]
  let fromIdx: number
  if (hasInterior(arcA) || arcB.length === 0) {
    chain = arcA
    fromIdx = i
  } else {
    chain = arcB
    fromIdx = j
  }
  // Normalise to low → high: reverse if the chain starts at the upper edge vertex.
  if (clipped[fromIdx].elevation > (ob + ot) / 2) chain = chain.slice().reverse()
  return { ob, ot, chain }
}

/**
 * Insert notches into a polygon ring along the single edge whose BOTH endpoints
 * sit on column edge ``side``.
 *
 * Each overlay shares its base with the matrix on column edge ``side``; its
 * (clipped) interior boundary becomes a notch on that edge — one concave ring,
 * never a hole or a split (a LEFT overlay lives in the left half, a RIGHT one in
 * the right half, so an overlay only ever sits in a matrix it shares a column
 * edge with). No general polygon-boolean is needed.
 *
 * Walking the ring, when we traverse the edge ``a → b`` with both endpoints at
 * ``side``, we cut each notch as ``near → chain → far`` where near/far follow the
 * traversal direction (up the edge → near = the lower elevation, chain low→high).
 * Stacked notches (multiple overlays on one edge) are inserted in elevation order
 * so they don't cross; overlays never overlap each other (LL1), so the cuts are
 * disjoint.
 *
 * Parameters
 * ----------
 * poly : PartitionPoint[]
 *     The matrix polygon ring (closed, no repeated last point).
 * side : 0 | 1
 *     The column edge to notch (0 = left, 1 = right).
 * notches : OverlayNotch[]
 *     The notches to cut into that edge.
 *
 * Returns
 * -------
 * PartitionPoint[]
 *     A new ring with the notches cut in (concave).
 */
export function insertNotches(
  poly: PartitionPoint[],
  side: 0 | 1,
  notches: OverlayNotch[],
): PartitionPoint[] {
  if (notches.length === 0) return poly
  const out: PartitionPoint[] = []
  const n = poly.length
  let cut = false // only the first qualifying edge is notched (a simple ring touches `side` once)
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    out.push(a)
    const aOn = Math.abs(a.fraction - side) < FRAC_EPS
    const bOn = Math.abs(b.fraction - side) < FRAC_EPS
    if (!cut && aOn && bOn) {
      cut = true
      const dir = b.elevation - a.elevation // > 0 → traversing up the edge
      // Drop any notch whose [ob, ot] overlaps an earlier one. Overlays never
      // overlap each other today (LL1), so this is a defensive guard for the
      // future nested-lens case (a lens inside a lens) — overlapping notches
      // would self-intersect the matrix ring; the skipped overlay stays a
      // harmless overlay instead.
      const byElev = [...notches].sort((p, q) => p.ob - q.ob)
      const safe: OverlayNotch[] = []
      let lastOt = -Infinity
      for (const nt of byElev) {
        if (nt.ob < lastOt - SPAN_EPS) continue
        safe.push(nt)
        lastOt = nt.ot
      }
      const ordered = dir >= 0 ? safe : [...safe].reverse()
      for (const nt of ordered) {
        const near = dir >= 0 ? nt.ob : nt.ot
        const far = dir >= 0 ? nt.ot : nt.ob
        const chain = dir >= 0 ? nt.chain : [...nt.chain].reverse()
        out.push(
          { fraction: side, elevation: near },
          ...chain.map((p) => ({ fraction: p.fraction, elevation: p.elevation })),
          { fraction: side, elevation: far },
        )
      }
    }
  }
  return out
}

/**
 * Subtract every lens/onlap overlay from the matrix region it sits in, in place,
 * so the gap's regions become a TRUE partition: each point belongs to exactly
 * one region.
 *
 * Owner's Solution 2 ("rest on the clay"): each overlay is first CLIPPED to its
 * enclosing matrix (so a straddle lens's base follows the sloping seam of the
 * body beneath it rather than crossing into it), then that clipped shape is
 * carved out of the matrix as a notch. A fully-enclosed lens clips to itself
 * unchanged, so the simple apex notch is the special case.
 *
 * Run as a post-pass at the end of ``emitGap`` — after all mains + overlays are
 * emitted. Only the matrix polygons gain notches; each overlay's polygon is
 * replaced by its clipped (seam-riding) shape so it exactly fills its notch.
 *
 * Parameters
 * ----------
 * regions : PartitionRegion[]
 *     One gap's regions (mutated in place: overlay + matrix ``polygon``s change).
 */
export function carveOverlays(regions: PartitionRegion[]): void {
  const mains = regions.filter((r) => r.kind === 'quad' || r.kind === 'pinch')
  const onlaps = regions.filter((r) => r.overlayTier === 'onlap')
  const lenses = regions.filter((r) => r.overlayTier === 'lens')
  if (mains.length === 0) return

  // Notches to cut, grouped by the region they cut into and the column side. All
  // notches are accumulated first and applied once at the end, so every clip sees
  // a CONVEX target (a region is never mutated until all overlays riding on it
  // have been clipped against it).
  const byTarget = new Map<PartitionRegion, { 0: OverlayNotch[]; 1: OverlayNotch[] }>()
  const recordNotch = (t: PartitionRegion, side: 0 | 1, nt: OverlayNotch): void => {
    let g = byTarget.get(t)
    if (!g) {
      g = { 0: [], 1: [] }
      byTarget.set(t, g)
    }
    g[side].push(nt)
  }

  /**
   * Clip ``ov`` to the tightest enclosing ``candidate`` (by column-edge span on
   * the side ``ov`` is anchored to), replace ``ov``'s polygon with the clipped
   * (seam-riding) shape, and record the notch to cut into that candidate. Returns
   * the candidate the overlay rode on, or ``null`` when none enclosed it (the
   * overlay is then left untouched — a harmless overlay).
   */
  const carveOnto = (ov: PartitionRegion, candidates: PartitionRegion[]): PartitionRegion | null => {
    const onLeft = edgeElevations(ov.polygon, 0)
    const onRight = edgeElevations(ov.polygon, 1)
    let side: 0 | 1
    let edgeElevs: number[]
    if (onLeft.length >= 2) {
      side = 0
      edgeElevs = onLeft
    } else if (onRight.length >= 2) {
      side = 1
      edgeElevs = onRight
    } else {
      return null // defensive: overlay not anchored on a column edge
    }
    const ob = Math.min(...edgeElevs)
    const ot = Math.max(...edgeElevs)

    // The region this overlay sits in: a candidate with >= 2 verts on `side` whose
    // edge-span contains [ob, ot]. Pick the TIGHTEST span — when an onlap and the
    // main beneath it both enclose a lens, the onlap is tighter, so the lens rides
    // (and carves out of) the onlap, not the main it shares.
    let best: PartitionRegion | null = null
    let bestSpan = Infinity
    for (const c of candidates) {
      const ce = edgeElevations(c.polygon, side)
      if (ce.length < 2) continue
      const lo = Math.min(...ce)
      const hi = Math.max(...ce)
      if (lo <= ob + SPAN_EPS && hi >= ot - SPAN_EPS) {
        const span = hi - lo
        if (span < bestSpan) {
          best = c
          bestSpan = span
        }
      }
    }
    if (!best) return null // no enclosing region (e.g. lens at the column floor)

    // Clip the overlay to the target so it rides the seam, then derive its notch.
    const clipped = clipToConvex(ov.polygon, best.polygon)
    if (clipped.length < 3) return null // degenerate after clipping — leave as-is
    const notch = notchFromClipped(clipped, side)
    if (!notch) return null
    ov.polygon = clipped // the overlay now exactly fills its notch (seam-riding)
    recordNotch(best, side, notch)
    return best
  }

  // Tier 1: onlaps ride on the mains (the connected matrix band beneath them).
  for (const ov of onlaps) carveOnto(ov, mains)
  // Tier 2: lenses ride on the onlap they sit inside FIRST (an enclosed minority
  // inside an onlapping clay — the tie-section-11 peat), else on a main. Onlaps
  // were clipped above but not yet notched, so they are still convex here; mains
  // are likewise untouched until the apply pass below. Both clips stay convex.
  for (const ov of lenses) carveOnto(ov, [...onlaps, ...mains])

  // Apply every accumulated notch once per target/side (insertNotches orders +
  // de-overlaps stacked notches). Onlaps that gained lens notches turn concave
  // here; that is after all clipping, so no clip ever saw a concave target.
  for (const [t, g] of byTarget) {
    if (g[0].length > 0) t.polygon = insertNotches(t.polygon, 0, g[0])
    if (g[1].length > 0) t.polygon = insertNotches(t.polygon, 1, g[1])
  }
}

/**
 * Emit a ONE-SIDED pinch interval as apex-sharing triangles (Thread A).
 *
 * Every pinch unit lives on ``side`` (the unit is absent on the opposite column,
 * so the interval converges there). One shared apex is placed at fraction ``f``
 * from the pinch side; each stacked pinch becomes a sub-triangle to the apex, and
 * a SINGLE matrix extension closes the wedge beyond the apex:
 *
 *   - matrix above present → apex on the BASE interface; the above matrix
 *     descends to fill the wedge while the unit BELOW keeps its flat correlated
 *     top (no extension for it);
 *   - no matrix above (surface) → apex on the TOP interface (surface); the
 *     below matrix rises to fill.
 *
 * The result tiles exactly (N pinch sub-triangles + one matrix triangle all
 * share the apex), so the pinch tips mid-gap (no droop to the neighbour) while
 * the fill stays hole-free. Two-sided (interfingering) intervals are NOT handled
 * here — the caller routes those to ``emitInterval``.
 *
 * Parameters
 * ----------
 * pinches : PinchUnit[]
 *     The unmatched units, all on ``side`` (sorted internally top→bottom).
 * side : 'left' | 'right'
 *     The column the pinches live on.
 * topIface, baseIface : Interface
 *     The interval's enclosing interfaces.
 * above, below : the matrix quad ABOVE / BELOW the interval, or ``null`` at the
 *     surface / floor respectively.
 * leftSurface, rightSurface : column surface elevations (mTAW).
 * f : tip fraction measured from the pinch side (``INTERIOR_PINCH_FRACTION``).
 * apexElevFloor : optional minimum elevation (mTAW) the convergence apex may take
 *     — the gap's CAP line (the shallow-TD elevation below which the deep-to-deep
 *     substrate pass owns the section; ``computeSectionFill`` caps every emitGap
 *     region there). A boundary pinch tapers toward its base interface, which on
 *     the deep column can dip BELOW this cap; without the clamp the apex dips past
 *     the cap and the cap then truncates the taper to an OFF-CENTRE, abrupt end
 *     (the GAP-19 "square end" dogfeed bug — a clay tipping at fraction ~0.30
 *     instead of 0.5). Clamping the apex UP to the cap line makes the taper
 *     converge to a clean POINT at the halfway fraction exactly on the cap line:
 *     the deeper corner below the cap is removed cleanly by the cap, leaving the
 *     point at ``f``. A pinch apex never legitimately sits below the cap (the
 *     substrate owns that band), so the clamp is safe for every interval. Default
 *     ``-Infinity`` (no clamp) — used by the substrate pass's own ``emitGap``
 *     call, which IS the below-cap region and must taper freely to its own base.
 *
 * Returns
 * -------
 * PartitionRegion[]
 *     ``[...pinch sub-triangles, above extension?, below extension?]``.
 */
export function emitOneSidedPinch(
  pinches: PinchUnit[],
  side: 'left' | 'right',
  topIface: Interface,
  baseIface: Interface,
  above: { formationId: string; bodyId: string | null } | null,
  below: { formationId: string; bodyId: string | null } | null,
  leftSurface: number,
  rightSurface: number,
  f: number,
  apexElevFloor = -Infinity,
  belowIsTiedBand = false,
): PartitionRegion[] {
  const pinchFrac = side === 'left' ? 0 : 1
  const oppFrac = side === 'left' ? 1 : 0
  const pinchSurface = side === 'left' ? leftSurface : rightSurface
  const oppSurface = side === 'left' ? rightSurface : leftSurface
  const topOppDepth = side === 'left' ? topIface.rightDepth : topIface.leftDepth
  const baseOppDepth = side === 'left' ? baseIface.rightDepth : baseIface.leftDepth
  const topPinchDepth = side === 'left' ? topIface.leftDepth : topIface.rightDepth
  const basePinchDepth = side === 'left' ? baseIface.leftDepth : baseIface.rightDepth

  // LENS vs BOUNDARY pinch.
  //   - Same matrix FORMATION above AND below → the unit is a LENS inside one
  //     material (clay/silt/clay). It must pinch at its OWN elevation (no
  //     droop), with the matrix filling around it from BOTH sides.
  //   - Otherwise → a BOUNDARY pinch: the unit below keeps its flat correlated
  //     top and only the ABOVE matrix descends to fill (or, at the surface, the
  //     below matrix rises). (owner directive 2026-06-08: an enclosed silt was
  //     drooping all the way down to the lower clay's base.)
  const isLens = above !== null && below !== null && above.formationId === below.formationId

  // A mixed-tie WEDGE: the enclosing interfaces CONVERGE on the opposite column
  // (topOppDepth ≈ baseOppDepth → the two correlation lines meet there). Instead of
  // pinching to the interior fraction and letting the above matrix flood the wedge,
  // taper the unit STRAIGHT to that far point — "colour between the two converging
  // lines" (owner directive 2026-07-10). A lens keeps its own-elevation apex.
  // Requires both above AND below to be non-null: a surface pinch (above=null) or
  // floor pinch (below=null) has no enclosing matrix to converge between — the EPS
  // guard would mis-fire there because the shared-TD interface depths happen to be equal.
  const convergesOnOpp =
    !isLens &&
    above !== null &&
    below !== null &&
    Math.abs(topOppDepth - baseOppDepth) < EPS
  const apexFraction = convergesOnOpp ? oppFrac : side === 'left' ? f : 1 - f

  let apexElev: number
  if (convergesOnOpp) {
    // The far point where the two interfaces meet on the opposite column.
    apexElev = oppSurface - (topOppDepth + baseOppDepth) / 2
  } else if (isLens) {
    // The pinch block's own mid-elevation — the lens tapers horizontally.
    apexElev = pinchSurface - (topPinchDepth + basePinchDepth) / 2
  } else if (above) {
    apexElev = ifaceElev(baseIface, apexFraction, leftSurface, rightSurface)
  } else {
    apexElev = ifaceElev(topIface, apexFraction, leftSurface, rightSurface)
  }
  // Clamp the convergence apex UP to the cap line — see the ``apexElevFloor`` doc.
  // A boundary pinch tapering toward its base interface dips BELOW the cap (the
  // shallow-TD line the substrate pass owns); the cap would then truncate the taper
  // to an off-centre, abrupt tip (the GAP-19 "square end" dogfeed bug). Clamping the
  // apex up to the cap makes it taper to a clean POINT at the halfway fraction on
  // the cap line. ``apexElevFloor`` is the PRE-injection cap (passed by
  // ``computeSectionFill`` as ``capElev``) — virtual/bridge units never inflate it,
  // so an interior pinch resting on a real band ABOVE the cap keeps its apex (its
  // elevation exceeds the cap, the clamp does not fire); only a genuinely-below-cap
  // floor pinch is raised. A lens keeps its own mid-elevation apex untouched.
  // A converging wedge apex sits at its real tie point — never clamp it up to the cap.
  if (!isLens && !convergesOnOpp && apexElev < apexElevFloor) apexElev = apexElevFloor
  const apex: PartitionPoint = { fraction: apexFraction, elevation: apexElev }

  // The interval has zero thickness on the OPPOSITE column (the unit is absent
  // there) — the two interfaces meet at this convergence point.
  const conv: PartitionPoint = {
    fraction: oppFrac,
    elevation: oppSurface - (topOppDepth + baseOppDepth) / 2,
  }

  const out: PartitionRegion[] = []
  // Each stacked pinch → a sub-triangle from its own depth span on the pinch
  // edge to the SHARED apex (one apex for the whole stack), so N stacked units
  // tile the pinch block exactly.
  const sorted = [...pinches].sort((a, b) => a.ownTopDepth - b.ownTopDepth)
  for (const p of sorted) {
    const top: PartitionPoint = { fraction: pinchFrac, elevation: pinchSurface - p.ownTopDepth }
    const base: PartitionPoint = { fraction: pinchFrac, elevation: pinchSurface - p.ownBaseDepth }
    out.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon: [top, apex, base] })
  }
  const topCorner: PartitionPoint = { fraction: pinchFrac, elevation: pinchSurface - topPinchDepth }
  const baseCorner: PartitionPoint = { fraction: pinchFrac, elevation: pinchSurface - basePinchDepth }
  // Matrix extensions close the wedge beyond the apex (merged contact apex→conv).
  // A LENS fills from BOTH sides (same material) so the unit keeps its own level;
  // a BOUNDARY pinch fills from the ABOVE side only (the unit below stays flat),
  // or from BELOW at the surface. A converging wedge already tapers to conv (apex ===
  // conv), so its pinch triangles fill the whole wedge — no matrix extension (and any
  // it emitted would be degenerate / would flood the wedge with the neighbour litho,
  // the exact spill this fix removes).
  if (convergesOnOpp) {
    // nothing to close — the wedge reaches the far tie point on its own.
  } else if (above && below && above.formationId === below.formationId) {
    // When the interval has zero thickness on the opposite side (topOppDepth ≈
    // baseOppDepth), conv coincides with a corner of the adjacent matched quad.
    // Emitting the two closing triangles in that case creates overlaps — skip.
    if (Math.abs(topOppDepth - baseOppDepth) >= EPS) {
      out.push({ formationId: above.formationId, bodyId: above.bodyId, kind: 'quad', polygon: [topCorner, conv, apex] })
      out.push({ formationId: below.formationId, bodyId: below.bodyId, kind: 'quad', polygon: [baseCorner, apex, conv] })
    }
  } else if (above) {
    out.push({ formationId: above.formationId, bodyId: above.bodyId, kind: 'quad', polygon: [topCorner, conv, apex] })
  } else if (below) {
    // At the surface the below matrix normally RISES to fill the interval. But a
    // user-correlated (tagged) band ENDS at its ties — it must not rise above its
    // own top (owner directive 2026-07-09: "onlap the clay on the band and fill
    // above with clay"). When the below unit is such a band AND the interval apex
    // bulges ABOVE the band's top on the opposite (degenerate) column
    // (``apex.elevation > conv.elevation``: the pinch-side surface sits higher than
    // the band top, so a rising band would overshoot its tie), fill the wedge with
    // the ADJACENT pinch material (the overlying lithology that onlaps the band)
    // instead of the band's own material — so the band stays a clean quad and the
    // overlying unit closes down to its top tie, with no spurious below-band bulge
    // and no coincident-edge sliver. When ``apex.elevation == conv.elevation`` the
    // band already reaches the interval top on the opposite side (a genuine surface
    // pinch, e.g. a lone Veen over a continuous Klei) — the below-rise is correct,
    // so the guard leaves it untouched.
    const deepestPinch = sorted.length > 0 ? sorted[sorted.length - 1] : null
    const bandOvershoots = belowIsTiedBand && apex.elevation > conv.elevation + EPS
    const surfaceFill =
      bandOvershoots && deepestPinch !== null
        ? { formationId: deepestPinch.formationId, bodyId: deepestPinch.bodyId }
        : below
    out.push({
      formationId: surfaceFill.formationId,
      bodyId: surfaceFill.bodyId,
      kind: 'quad',
      polygon: [baseCorner, apex, conv],
    })
  }
  return out
}

// ---------------------------------------------------------------------------
