/**
 * WHAT BORDERS WHAT — the arrangement's own adjacency, on the merge's own grid.
 *
 * Two rules of the fill ask the same question of a gap's loops: the pocket rule
 * (*"it should all be one dense sand body?"*, ``pocketFaces.ts``) and the
 * least-dense leftover (*"you fill with the lowest density"*,
 * ``leastDenseLeftover.ts``). Both need to know which faces LIE AGAINST which,
 * and both must read it the way ``mergeFaces`` will: a pair the merge would call
 * interior is a pair these rules must call adjacent, or a face re-owned by one
 * of them lands beside its new mass as a second region with an invisible seam
 * instead of welding into it.
 *
 * The answer is exact rather than geometric. ``overlayFaces`` returns a planar
 * arrangement, so two faces share a BOUNDARY exactly when they carry the same
 * undirected edge — no distance test, no tolerance beyond the vertex grid, and
 * no way for a face to "nearly" border another.
 *
 * Pure module — rings in, indices out.
 *
 * @module utils/geotechHierarchicalFill/constructive/faceAdjacency
 */

import type { FacePoint } from './mergeFaces'

/**
 * Vertex quantisation — the SAME grid ``mergeFaces`` welds on.
 *
 * Two faces are adjacent here exactly when the merge would call their shared
 * edge interior, so a face re-owned on this evidence welds into its new mass
 * rather than landing beside it as a second region with an invisible seam.
 */
const GRID = 1e7

const vertexKey = (p: FacePoint): string =>
  `${Math.round(p.fraction * GRID)}:${Math.round(p.elevation * GRID)}`

/** Undirected identity of one ring edge. */
const edgeKey = (a: FacePoint, b: FacePoint): string => {
  const ka = vertexKey(a)
  const kb = vertexKey(b)
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

/**
 * Drop consecutive duplicate vertices, and the wrap-around duplicate.
 *
 * @param ring One arrangement loop.
 * @returns The same loop with no repeated vertex, so its edges are real edges.
 */
export function dedupe(ring: readonly FacePoint[]): FacePoint[] {
  const out: FacePoint[] = []
  for (const p of ring) {
    const prev = out[out.length - 1]
    if (prev !== undefined && vertexKey(prev) === vertexKey(p)) continue
    out.push(p)
  }
  while (out.length > 1 && vertexKey(out[0]) === vertexKey(out[out.length - 1])) out.pop()
  return out
}

/**
 * Every pair of loops that share an edge.
 *
 * A planar arrangement gives each edge exactly two faces, so one entry per
 * shared edge is the whole of the adjacency. Pairs come back in the order the
 * SECOND face of each was met, which makes the result a function of the input
 * order alone.
 *
 * @param rings The gap's loops, already de-duplicated (see {@link dedupe}).
 * @returns One ``[i, j]`` per shared edge, ``i`` met before ``j``.
 */
export function sharedEdgePairs(rings: readonly (readonly FacePoint[])[]): [number, number][] {
  const seen = new Map<string, number>()
  const shared: [number, number][] = []
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i]
    for (let v = 0; v < ring.length; v++) {
      const key = edgeKey(ring[v], ring[(v + 1) % ring.length])
      const other = seen.get(key)
      if (other === undefined) seen.set(key, i)
      else shared.push([other, i])
    }
  }
  return shared
}

/**
 * Union-find over a fixed set of indices.
 *
 * @param count How many indices there are.
 * @param pairs The pairs to merge — the caller filters these to the ones it
 *   considers one group (same mass, both unclassed, ...).
 * @returns One root index per input index; two indices share a root exactly
 *   when the pairs connect them.
 */
export function connectedComponents(count: number, pairs: readonly [number, number][]): number[] {
  const parent = Array.from({ length: count }, (_, i) => i)
  const find = (i: number): number => {
    let root = i
    while (parent[root] !== root) root = parent[root]
    parent[i] = root
    return root
  }
  for (const [a, b] of pairs) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  return parent.map((_, i) => find(i))
}
