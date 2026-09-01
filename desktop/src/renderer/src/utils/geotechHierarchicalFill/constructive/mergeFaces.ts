/**
 * PHASE 3 — THE MERGE. *"the merge is to reduce the dimensions to a manageable
 * level"* (owner, 2026-08-19).
 *
 * The arrangement cuts the cover at EVERY line the framework draws, so one
 * class routinely comes back as a handful of loops that share seams and mean
 * one thing. This welds them: loops carrying the same class AND the same band
 * identity, touching along a shared edge, become one region with no internal
 * seam. Nothing moves — the union is exactly the loops' own ground — so the
 * merge can neither add nor lose paint; it only stops the render drawing seams
 * that say nothing, and gives the body evidence one face per mass instead of
 * a mosaic.
 *
 * The weld is by boundary walk: every edge stated twice inside a component is
 * interior and cancels, and what remains chains into the component's outline.
 * A component whose walk does not close into exactly ONE simple ring keeps its
 * loops unmerged — a ring with a hole cannot be expressed as one polygon, and
 * an honest mosaic is better than a wrong outline.
 *
 * @module utils/geotechHierarchicalFill/constructive/mergeFaces
 */

import {
  absorbSeparationIncidence,
  seedSeparationIncidence,
  unionCompletesSeparation,
} from '../../partitionFillV2/separationConstraint'

/** A point of a face ring, in one gap's fraction space. */
export interface FacePoint {
  fraction: number
  elevation: number
}

/** One labelled loop, ready to be merged with its like. */
export interface LabelledFace<T> {
  /** Everything that must match for two loops to weld — class and identity. */
  key: string
  /** The payload carried onto the emitted region (class, body, layer ids). */
  label: T
  ring: FacePoint[]
}

/**
 * The "Separate" cannot-link, threaded into the merge (owner 2026-08-31, debt #278 R5).
 * When present, two loops whose combined layer ids would carry BOTH sides of a standing
 * separation are kept in DIFFERENT components — the shared seam survives, so the paint
 * shows the split the engineer drew. Absent / empty leaves the merge byte-identical.
 */
export interface MergeFacesOptions<T> {
  /** The layer ids a loop's label carries — its side membership is read from these. */
  layerIdsOf?: (label: T) => readonly string[] | undefined
  /** Canonical ``a|b`` layer-id pairs the engineer separated. */
  separatedPairs?: ReadonlySet<string>
}

/** Quantised vertex key — the arrangement's own snapped vertices land exactly. */
const GRID = 1e7

const vertexKey = (p: FacePoint): string =>
  `${Math.round(p.fraction * GRID)}:${Math.round(p.elevation * GRID)}`

/** Signed doubled area; positive = counter-clockwise. */
function signedArea2(ring: readonly FacePoint[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    sum += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return sum
}

/** Drop repeated consecutive vertices and orient counter-clockwise. */
function normalise(ring: readonly FacePoint[]): FacePoint[] {
  const out: FacePoint[] = []
  for (const p of ring) {
    const prev = out[out.length - 1]
    if (prev !== undefined && vertexKey(prev) === vertexKey(p)) continue
    out.push(p)
  }
  while (out.length > 1 && vertexKey(out[0]) === vertexKey(out[out.length - 1])) out.pop()
  if (out.length >= 3 && signedArea2(out) < 0) out.reverse()
  return out
}

/**
 * Weld same-class loops that touch.
 *
 * @param faces The labelled loops of ONE gap.
 * @returns One entry per merged mass (or per unmergeable loop), in input order.
 *   ``members`` carries every loop's label in the welded component, so a caller
 *   can keep each contributor's identity on the one region.
 */
export function mergeFaces<T>(
  faces: readonly LabelledFace<T>[],
  opts?: MergeFacesOptions<T>,
): { label: T; members: T[]; ring: FacePoint[]; welded: boolean }[] {
  const prepared = faces
    .map((face) => ({ ...face, ring: normalise(face.ring) }))
    .filter((face) => face.ring.length >= 3)

  const byKey = new Map<string, typeof prepared>()
  for (const face of prepared) {
    const list = byKey.get(face.key)
    if (list === undefined) byKey.set(face.key, [face])
    else list.push(face)
  }

  const out: { label: T; members: T[]; ring: FacePoint[]; welded: boolean }[] = []
  for (const group of byKey.values()) {
    // The "Separate" cannot-link over THIS group's loops (empty when the caller passes
    // no separations — the union below is then byte-identical to the plain merge). Seeded
    // per group on group-local indices, exactly the indices the union-find below uses.
    const layerIdsOf = opts?.layerIdsOf
    const { incidence, pairCount } = seedSeparationIncidence(
      group.length,
      (i) => layerIdsOf?.(group[i].label),
      () => true,
      opts?.separatedPairs,
    )
    // Components: loops of this group that share an edge.
    const parent = group.map((_, i) => i)
    const find = (i: number): number => {
      let root = i
      while (parent[root] !== root) root = parent[root]
      parent[i] = root
      return root
    }
    const owners = new Map<string, number>()
    group.forEach((face, i) => {
      for (let v = 0; v < face.ring.length; v++) {
        const a = vertexKey(face.ring[v])
        const b = vertexKey(face.ring[(v + 1) % face.ring.length])
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        const other = owners.get(key)
        if (other === undefined) owners.set(key, i)
        else {
          const ra = find(i)
          const rb = find(other)
          if (ra === rb) continue
          // Honour a standing separation: two loops whose combined layers hold BOTH sides
          // of a pair stay separate components, so their shared seam is not cancelled.
          if (pairCount > 0 && unionCompletesSeparation(incidence, ra, rb)) continue
          parent[ra] = rb
          if (pairCount > 0) absorbSeparationIncidence(incidence, rb, ra)
        }
      }
    })
    const components = new Map<number, number[]>()
    group.forEach((_, i) => {
      const root = find(i)
      const list = components.get(root)
      if (list === undefined) components.set(root, [i])
      else list.push(i)
    })

    for (const members of components.values()) {
      if (members.length === 1) {
        const only = group[members[0]]
        out.push({ label: only.label, members: [only.label], ring: only.ring, welded: false })
        continue
      }
      const merged = weld(members.map((i) => group[i].ring))
      if (merged === null) {
        // Not one simple ring — keep the loops, but every piece still carries
        // the whole component's identities, because the component IS one mass.
        const all = members.map((i) => group[i].label)
        for (const i of members)
          out.push({ label: group[i].label, members: all, ring: group[i].ring, welded: false })
        continue
      }
      out.push({
        label: group[members[0]].label,
        members: members.map((i) => group[i].label),
        ring: merged,
        welded: true,
      })
    }
  }
  return out
}

/**
 * The outline of a set of edge-sharing loops, or null when it is not one simple
 * ring (a hole, or a walk that does not close).
 */
function weld(rings: readonly FacePoint[][]): FacePoint[] | null {
  const directed = new Map<string, { from: FacePoint; to: FacePoint }[]>()
  const count = new Map<string, number>()
  const bump = (key: string): void => {
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const from = ring[i]
      const to = ring[(i + 1) % ring.length]
      bump(`${vertexKey(from)}>${vertexKey(to)}`)
    }
  }
  let edges = 0
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const from = ring[i]
      const to = ring[(i + 1) % ring.length]
      const forward = `${vertexKey(from)}>${vertexKey(to)}`
      const back = `${vertexKey(to)}>${vertexKey(from)}`
      // Stated in both directions ⇒ interior to the component; it cancels.
      if ((count.get(back) ?? 0) > 0) continue
      if ((count.get(forward) ?? 0) > 1) return null // a repeated boundary edge
      const key = vertexKey(from)
      const list = directed.get(key)
      if (list === undefined) directed.set(key, [{ from, to }])
      else list.push({ from, to })
      edges += 1
    }
  }
  if (edges < 3) return null
  // Chain the surviving edges. A vertex with more than one outgoing edge is a
  // pinch point where the walk could take either branch — refuse rather than
  // guess.
  for (const list of directed.values()) if (list.length > 1) return null
  const start = directed.values().next().value as { from: FacePoint; to: FacePoint }[]
  const ring: FacePoint[] = [start[0].from]
  let cursor = start[0]
  for (let guard = 0; guard <= edges; guard++) {
    const nextKey = vertexKey(cursor.to)
    if (nextKey === vertexKey(ring[0])) {
      return ring.length >= 3 && ring.length === edges ? ring : null
    }
    ring.push(cursor.to)
    const next = directed.get(nextKey)
    if (next === undefined) return null
    cursor = next[0]
  }
  return null
}
