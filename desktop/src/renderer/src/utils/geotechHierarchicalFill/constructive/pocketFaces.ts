/**
 * NO ISLANDS — *"that weird lens quad has no provenance, it isn't in the litho,
 * it isn't in the geotech model"* / *"it should all be one dense sand body?
 * fill merge should have filled that and merged that weird constructor line?"*
 * (owner dogfeed 2026-08-25, Cross-section 3, gap 7).
 *
 * The shape he circled was a construct's own leftover: a band carried across a
 * blind column (``bandContinuation.ts``) pinches toward the test that actually
 * reads its ground, the litho cover crosses that pinch, and what survives
 * inside the cover is a triangle touching NEITHER of the gap's two tests —
 * medium-dense sand floating in the middle of a dense body, reachable from
 * nothing.
 *
 * THE RULE, and it is his: **a face may never be an ISLAND detached from its
 * winning band's own ground.** A band answers the ground it can be reached
 * from — its own column face, or a same-mass face contiguous with it. A
 * connected component of one mass that touches neither of the gap's own
 * columns and is bounded, everywhere a face lies against it, by a SINGLE other
 * mass is a POCKET of that mass, and that is who it belongs to.
 *
 * THREE THINGS THE RULE DELIBERATELY DOES NOT DO:
 *
 *  * it never touches a mass that reaches a column. The SF-silt fill-through
 *    (ruled 2026-08-21) is an OPEN mass running past the middle — contiguous
 *    from its own test all the way — and contiguity is exactly what tells it
 *    from an island. So is every ordinary lens and onlap: both are anchored at
 *    the column whose test states them.
 *  * it never invents an owner. A component with two or more masses against it,
 *    or with unclassed ground against it, is not enclosed by anybody and keeps
 *    what it had.
 *  * it never absorbs into ground that is itself adrift. Where the enclosing
 *    mass reaches no column either — a litho cover that is a closed lens of its
 *    own, whose whole content is interior — the two are just the cover's
 *    stacked contents and neither swallows the other.
 *
 * The cover's own outline is neither an anchor nor a disqualifier: across it
 * lies another family's ground, which this mass has no claim on and no
 * connection through. Only the gap's two vertical edges anchor, because that
 * is where a test stands.
 *
 * Pure module — no I/O, no React, no geometry beyond the rings it is handed.
 *
 * @module utils/geotechHierarchicalFill/constructive/pocketFaces
 */

import { connectedComponents, dedupe, sharedEdgePairs } from './faceAdjacency'
import type { FacePoint } from './mergeFaces'

/**
 * How close to the cover's own edge a vertex must be to count as touching it.
 *
 * HALF THE ARRANGEMENT'S OWN SNAP STEP. ``overlayFaces`` identifies segments on
 * a 1e-3 grid of the fraction, so two points nearer than 5e-4 are one point as
 * far as every loop it hands back is concerned — and the cover's rings and the
 * faces cut from them do NOT agree to more than that: measured on his CS3, one
 * family's cover starts at 0.000005 while the face beside that very test starts
 * at 0.00001, and another ends at 0.999044 against a face at 0.999040. A
 * tighter epsilon declared four column-edge shapes adrift. The pocket this
 * exists for stands 0.156 from its nearest edge — three hundred times this.
 */
const COLUMN_EPS = 5e-4

/** One loop offered to the pocket rule. */
export interface PocketFace {
  /** The mass identity two faces must share to be one body — ``massKey``. */
  key: string
  ring: readonly FacePoint[]
}

/**
 * Where this gap's two tests stand, in the cover's own fraction space.
 *
 * NOT 0 and 1. The litho fill insets its regions by a metric amount, so the
 * cover's own right edge lands at 0.9956 in one gap and 0.9996 in another — and
 * a face sitting exactly on it IS beside that test, whatever the arithmetic
 * says. Measured on his CS3: an anchor test written against a literal 1
 * declared four column-edge shapes adrift in gaps 0, 2, 3 and 5.
 */
export interface CoverEdges {
  lo: number
  hi: number
}

/**
 * Re-own every pocket to the mass that encloses it.
 *
 * @param faces The labelled loops of ONE (family, gap) fill, in emit order.
 * @param edges Where the gap's two tests stand (see {@link CoverEdges}).
 * @returns One index per input face: the face whose mass it belongs to. A face
 *   that keeps its own owner maps to itself, so the caller can apply the result
 *   unconditionally.
 */
export function resolveIslands(faces: readonly PocketFace[], edges: CoverEdges): number[] {
  const rings = faces.map((face) => dedupe(face.ring))
  const n = rings.length
  const owner = faces.map((_, i) => i)
  // Components: faces of the same mass that share an edge.
  const shared = sharedEdgePairs(rings)
  const roots = connectedComponents(
    n,
    shared.filter(([a, b]) => faces[a].key === faces[b].key),
  )
  const find = (i: number): number => roots[i]
  // Per component: whether it reaches a column, and which other components lie
  // against it.
  const anchored = new Map<number, boolean>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const touches =
      anchored.get(root) === true ||
      rings[i].some(
        (p) => p.fraction <= edges.lo + COLUMN_EPS || p.fraction >= edges.hi - COLUMN_EPS,
      )
    anchored.set(root, touches)
  }
  const against = new Map<number, Set<number>>()
  for (const [a, b] of shared) {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) continue
    const listA = against.get(ra)
    if (listA === undefined) against.set(ra, new Set([rb]))
    else listA.add(rb)
    const listB = against.get(rb)
    if (listB === undefined) against.set(rb, new Set([ra]))
    else listB.add(ra)
  }
  // Members in ascending face order, so ``[0]`` is a component's canonical face.
  const members = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const list = members.get(root)
    if (list === undefined) members.set(root, [i])
    else list.push(i)
  }
  // ONE PASS, over the masses the fill decided — never over its own answers. A
  // pocket cannot free another anyway (two pockets lying against each other
  // each see two masses, so neither is enclosed and neither moves — the nested
  // case keeps what it had, PF5), and reading back through ``owner`` mid-loop
  // would make the outcome depend on the order the arrangement emitted faces in
  // without changing a single scene.
  for (const [root, component] of members) {
    if (anchored.get(root) === true) continue
    const neighbours = against.get(root)
    if (neighbours === undefined) continue
    // Exactly ONE MASS against it — not one component. Two components of the
    // same mass lying against a pocket from opposite sides still enclose it;
    // two different masses do not enclose anything, and neither does unclassed
    // ground, which carries no face here at all and so leaves the pocket with a
    // side the rule cannot read.
    const masses = new Set<string>()
    for (const other of neighbours) masses.add(faces[other].key)
    if (masses.size !== 1) continue
    // The enclosing ground must itself reach a column, or nothing here is
    // anchored and there is no "around" to belong to. Where that mass stands
    // against the pocket in two pieces, the one carrying the lowest-numbered
    // face answers — a canonical choice, not the union-find's own bookkeeping.
    const enclosing = [...neighbours]
      .filter((other) => anchored.get(other) === true)
      .map((other) => (members.get(other) as number[])[0])
      .sort((a, b) => a - b)[0]
    if (enclosing === undefined) continue
    for (const face of component) owner[face] = enclosing
  }
  return owner
}
