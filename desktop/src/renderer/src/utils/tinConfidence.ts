// Per-triangle interpolation confidence for a TIN surface (debt #28).
//
// Cheap interim shape — the geological model uses unconstrained Delaunay
// today, so regions far from a contact look identical to data-backed
// regions even though the surface is pure extrapolation there.  This
// helper computes a per-triangle confidence value 0..1 that drives a
// fade in the 3D viewer and the section editor's TIN slice render.
//
// Two ingredients:
//
// 1. **Hull-edge triangles** — any triangle that has an edge appearing
//    in only one triangle is on the convex hull boundary.  These are
//    the "spike" triangles that fan out into the data-sparse periphery;
//    by far the most common edge artifact.  Fixed-confidence floor.
//
// 2. **Edge-length gradient** — interior triangles' confidence falls
//    with their longest edge, normalized against the median edge length
//    across the whole TIN.  A triangle with maxEdge == median gets 1.0;
//    2× median → 0.5; clamped to the hull-edge floor at the bottom.
//
// Both signals are derived purely from `vertices` + `triangles` — no
// schema change, no migration.  When the kriging / RBF interpolator
// lands (Phase 5) the variance-based metric replaces this one and the
// helper goes away.

/**
 * Floor confidence for hull-edge triangles AND the gradient lower bound.
 * Picked so the visual delta is clear at 0.3× rendered alpha while still
 * keeping the band readable as the same formation.
 */
export const CONFIDENCE_FLOOR = 0.3

/**
 * Threshold separating "data-backed" from "extrapolation" bands.
 * Triangles with confidence >= this value render at full alpha; below
 * render at the low-confidence multiplier.
 */
export const CONFIDENCE_THRESHOLD = 0.7

/**
 * Alpha multiplier applied to low-confidence triangles in the 3D
 * viewer + section editor.  Same value on both surfaces for visual
 * parity.  Hull-edge + interior-low-density end up at the same band
 * by design — the engineer reads the cue as "less to trust here", not
 * a two-axis classification.
 */
export const LOW_CONFIDENCE_ALPHA_MULTIPLIER = 0.25

function _median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function _edgeKey(a: number, b: number): string {
  // Canonical undirected-edge key: (min, max) so (a, b) and (b, a) hash
  // to the same bucket for the hull-edge detection counter.
  return a < b ? `${a}-${b}` : `${b}-${a}`
}

function _edgeLengthXY(
  vertices: readonly (readonly [number, number, number])[],
  i: number,
  j: number,
): number {
  // Horizontal-plane distance only — TIN "spread" is the (x, y)
  // footprint; the elevation delta is the SIGNAL we want to render, not
  // the data-sparsity metric. Two vertices stacked vertically (same x,
  // y) would otherwise look like a wide gap.
  const dx = vertices[i][0] - vertices[j][0]
  const dy = vertices[i][1] - vertices[j][1]
  return Math.hypot(dx, dy)
}

/**
 * Compute per-triangle interpolation confidence for a TIN surface.
 *
 * Parameters
 * ----------
 * vertices
 *     ``[[x, y, z], ...]`` — vertex positions in the surface's CRS.
 * triangles
 *     ``[[i_a, i_b, i_c], ...]`` — vertex indices, one tuple per
 *     triangle.  Order within the tuple is irrelevant for confidence.
 *
 * Returns
 * -------
 * number[]
 *     Per-triangle confidence in ``[CONFIDENCE_FLOOR, 1.0]``.  Aligned
 *     with the ``triangles`` input — entry ``i`` is the confidence of
 *     ``triangles[i]``.  Empty input → empty output.
 */
export function computeTriangleConfidence(
  vertices: readonly (readonly [number, number, number])[],
  triangles: readonly (readonly [number, number, number])[],
): number[] {
  if (triangles.length === 0) return []

  // -- Step 1: hull-edge detection ------------------------------------
  // Count how many triangles each edge appears in. An edge in exactly
  // one triangle is on the convex-hull boundary.
  const edgeCount = new Map<string, number>()
  for (const tri of triangles) {
    const [a, b, c] = tri
    for (const key of [_edgeKey(a, b), _edgeKey(b, c), _edgeKey(c, a)]) {
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
    }
  }

  // Degenerate TIN escape hatch: a triangulation with no INTERIOR
  // triangles at all (every triangle has a hull-edge) has nothing to
  // grade against — the engineer can't visually distinguish "all
  // sparse" from "all dense" because there is no reference point.
  // Render uniformly at full confidence so a newly-built 3-contact
  // surface doesn't look perpetually faded until a 4th contact lands.
  // Reach for this when triangles.length <= 2 OR when no triangle
  // has all three edges shared.
  const hasInteriorTriangle = triangles.some(tri => {
    const [a, b, c] = tri
    return (
      (edgeCount.get(_edgeKey(a, b)) ?? 0) > 1 &&
      (edgeCount.get(_edgeKey(b, c)) ?? 0) > 1 &&
      (edgeCount.get(_edgeKey(c, a)) ?? 0) > 1
    )
  })
  if (!hasInteriorTriangle) {
    return triangles.map(() => 1.0)
  }

  // -- Step 2: collect edge lengths for the median --------------------
  // Iterate the unique-edge set (not the triangles) so a shared
  // interior edge isn't double-counted in the median calculation.
  const edgeLengths: number[] = []
  const lengthCache = new Map<string, number>()
  for (const tri of triangles) {
    const [a, b, c] = tri
    for (const [i, j] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = _edgeKey(i, j)
      if (!lengthCache.has(key)) {
        const len = _edgeLengthXY(vertices, i, j)
        lengthCache.set(key, len)
        edgeLengths.push(len)
      }
    }
  }
  const medianEdge = _median(edgeLengths)

  // -- Step 3: per-triangle confidence --------------------------------
  const out: number[] = []
  for (const tri of triangles) {
    const [a, b, c] = tri
    const edges: [number, string][] = [
      [_edgeLengthXY(vertices, a, b), _edgeKey(a, b)],
      [_edgeLengthXY(vertices, b, c), _edgeKey(b, c)],
      [_edgeLengthXY(vertices, c, a), _edgeKey(c, a)],
    ]
    const isHullEdge = edges.some(([, key]) => (edgeCount.get(key) ?? 0) <= 1)
    if (isHullEdge) {
      out.push(CONFIDENCE_FLOOR)
      continue
    }
    // Interior triangle: gradient by longest-edge / median.
    const maxEdge = Math.max(edges[0][0], edges[1][0], edges[2][0])
    if (medianEdge === 0) {
      // Degenerate TIN (all edges zero-length); push max confidence.
      out.push(1.0)
      continue
    }
    // 1× median → 1.0; 2× median → 0.5; falls linearly. Anything
    // longer clamps to the floor.
    const raw = 1 - (maxEdge / medianEdge - 1) * 0.5
    out.push(Math.max(CONFIDENCE_FLOOR, Math.min(1.0, raw)))
  }
  return out
}

/**
 * Partition a triangle list into two index buckets by confidence band.
 *
 * **Deprecated as the primary renderer path 2026-05-21** — the
 * per-vertex gradient renderers (Geology3DViewer + ContactsLayer) now
 * consume continuous confidence directly via
 * ``confidenceToAlphaMultiplier`` instead of binarising into two bins.
 * The binary partition produced a visible cliff at the threshold that
 * the engineer read as "two distinct regions" when the underlying math
 * is a smooth distance signal.
 *
 * Kept exported for back-compat (still referenced by some pin tests +
 * the binary fallback when a renderer can't carry per-vertex alpha).
 */
export function partitionByConfidence(
  confidence: readonly number[],
): { high: number[]; low: number[] } {
  const high: number[] = []
  const low: number[] = []
  for (let i = 0; i < confidence.length; i += 1) {
    if (confidence[i] >= CONFIDENCE_THRESHOLD) high.push(i)
    else low.push(i)
  }
  return { high, low }
}

/**
 * Map a triangle's continuous confidence to its render alpha multiplier.
 *
 * Linear lerp from ``LOW_CONFIDENCE_ALPHA_MULTIPLIER`` at
 * ``CONFIDENCE_FLOOR`` to ``1.0`` at confidence ``1.0``.  Used by the
 * per-vertex gradient renderers to compute a smooth alpha that varies
 * with the underlying distance-to-data signal.
 *
 * Out-of-range inputs are clamped — anything below the floor maps to
 * the low multiplier, anything above 1.0 maps to 1.0.
 *
 * Parameters
 * ----------
 * confidence
 *     A value typically in ``[CONFIDENCE_FLOOR, 1.0]`` produced by
 *     ``computeTriangleConfidence`` or ``computeVertexConfidence``.
 *
 * Returns
 * -------
 * number
 *     Alpha multiplier in ``[LOW_CONFIDENCE_ALPHA_MULTIPLIER, 1.0]``.
 *     The caller multiplies its base alpha (formation surface fresh /
 *     stale alpha) by this to get the final render alpha.
 */
export function confidenceToAlphaMultiplier(confidence: number): number {
  const c = Math.max(CONFIDENCE_FLOOR, Math.min(1.0, confidence))
  const span = 1.0 - CONFIDENCE_FLOOR
  const t = span <= 0 ? 0 : (c - CONFIDENCE_FLOOR) / span
  return LOW_CONFIDENCE_ALPHA_MULTIPLIER + (1.0 - LOW_CONFIDENCE_ALPHA_MULTIPLIER) * t
}

/**
 * Compute per-vertex confidence by averaging incident triangles.
 *
 * For each vertex, looks at every triangle that references it and
 * averages those triangles' confidence values.  Vertices on the convex
 * hull share more low-confidence triangles → average down.  Vertices
 * deep in the data region share more high-confidence triangles →
 * average up.  Smooth across the surface — the GPU then interpolates
 * the resulting per-vertex alpha across each triangle.
 *
 * Parameters
 * ----------
 * vertices
 *     ``[[x, y, z], ...]`` — vertex positions.  Used only for length;
 *     the math runs on indices.
 * triangles
 *     ``[[i_a, i_b, i_c], ...]`` — vertex indices per triangle.
 * triangleConfidence
 *     Optional pre-computed per-triangle confidence (output of
 *     ``computeTriangleConfidence``).  Passed when the caller has
 *     already computed it; absent → computed here.
 *
 * Returns
 * -------
 * number[]
 *     Per-vertex confidence aligned with ``vertices``.  A vertex with
 *     no incident triangles (orphan) gets ``1.0`` — orphans don't
 *     render anyway; the value is a safe default.
 */
export function computeVertexConfidence(
  vertices: readonly (readonly [number, number, number])[],
  triangles: readonly (readonly [number, number, number])[],
  triangleConfidence?: readonly number[],
): number[] {
  if (vertices.length === 0) return []
  const triConf = triangleConfidence ?? computeTriangleConfidence(vertices, triangles)

  const sum = new Float64Array(vertices.length)
  const count = new Uint32Array(vertices.length)

  for (let t = 0; t < triangles.length; t += 1) {
    const [a, b, c] = triangles[t]
    const conf = triConf[t]
    sum[a] += conf
    sum[b] += conf
    sum[c] += conf
    count[a] += 1
    count[b] += 1
    count[c] += 1
  }

  const out: number[] = new Array(vertices.length)
  for (let i = 0; i < vertices.length; i += 1) {
    out[i] = count[i] === 0 ? 1.0 : sum[i] / count[i]
  }
  return out
}
