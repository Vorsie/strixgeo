/**
 * THE LEAST-DENSE LEFTOVER — the fill's last resort.
 *
 * Owner, 2026-08-26, ruling on the corrected two-level render:
 *
 *   *"if 2 lenses are pointed to eachother and there is nothing else to fill
 *    the gap, no open band above or below, then you fill with the lowest
 *    density"*
 *
 * The ground he is naming is a piece of litho cover trapped between two
 * legally-closed facing constructs, where every rung of ``remainderLadder.ts``
 * declines: the flanks are closed, the closure bars stand between the sample and
 * every band that might own it, and each band's own-shape guard refuses the
 * shadow under its own pinch. Real sand, plainly inside one body, standing as
 * the "correlate me" hatch because no rule had been written for it.
 *
 * Earlier the same day he threw out the other reading — split the leftover at
 * the vertical middle and give each half to its own side — in one word: *"a big
 * NOOOO"*. So:
 *
 *   **ONE region, no seam invented inside it, and its class is the LOWEST
 *   DENSITY among the masses that bound it.**
 *
 * WHAT "BOUND" MEANS, and it is defined here and nowhere else: the masses whose
 * own drawn shapes BORDER the leftover — every classed face that shares an edge
 * of the arrangement with it (``faceAdjacency.ts``). On his own scene that is
 * the two facing constructs, whose flanks are the leftover's two walls; where a
 * third band of the family lies against it inside the gap, that band counts too,
 * because it is holding the ground up just as much as the other two are. It is
 * deliberately NOT "the two facing constructs" by name: the engine has no way to
 * know which pair a leftover faces until it looks at what actually touches it,
 * and a rule written on the pair alone would have missed the third wall on the
 * first section that had one.
 *
 * LEAST DENSE is his own precedent from the stacked-seam holes (*"least dense
 * yeah"*, 2026-08-25): the lowest NAD class number in the family, read through
 * the same ``nadClassRank`` — including its documented admixture limit.
 *
 * FOUR THINGS THIS RULE DELIBERATELY DOES NOT DO:
 *
 *  * it never runs where anything else can answer. It is reached only after
 *    every rung of the ladder has declined, which is exactly his *"nothing else
 *    to fill the gap, no open band above or below"*. An open mass takes the
 *    ground first (the SF-silt fill-through, 2026-08-21) and a same-class facing
 *    pair is welded before a construct is even drawn (``coverWeld.ts``).
 *  * it never redraws a shape. The bounding constructs' rings are this rule's
 *    boundaries; the leftover is painted between them and the wedges do not
 *    move.
 *  * it never splits. A connected run of leftover faces — the vertical seam cuts
 *    his in two — is ONE unit with ONE owner, so the merge welds it into one
 *    region and no seam appears where the law never drew a line.
 *  * it never invents an owner. A leftover nothing classed lies against keeps
 *    its hatch, which is the honest floor for cover that has no neighbour at
 *    all.
 *
 * Pure module — labelled rings in, one owner index per ring out.
 *
 * @module utils/geotechHierarchicalFill/constructive/leastDenseLeftover
 */

import { connectedComponents, dedupe, sharedEdgePairs } from './faceAdjacency'
import type { FacePoint } from './mergeFaces'

/** One loop of a gap's fill, as this rule needs to see it. */
export interface LeftoverFace {
  /**
   * The mass the fill gave it — ``massKey`` — or null where every rung of the
   * ladder declined and the loop is the leftover this rule answers.
   */
  key: string | null
  /** That mass's NAD class, or null where its packing key carries none. */
  rank: number | null
  ring: readonly FacePoint[]
}

/**
 * Hand every leftover the least dense mass that bounds it.
 *
 * @param faces The gap's loops, AFTER the constructs, the ladder and the pocket
 *   rule have all had their say.
 * @returns One index per input face: the face whose mass it takes. A face that
 *   keeps what it had maps to itself — including a leftover nothing borders,
 *   which therefore stays unclassed and reaches the hatch as before.
 */
export function resolveLeftovers(faces: readonly LeftoverFace[]): number[] {
  const owner = faces.map((_, i) => i)
  const leftover = faces.map((face) => face.key === null)
  if (!leftover.some(Boolean)) return owner
  const rings = faces.map((face) => dedupe(face.ring))
  const shared = sharedEdgePairs(rings)
  // ONE region: leftover faces that touch are one piece of ground, whatever
  // line the arrangement happened to cut them on. His own scene is cut in two
  // by the seam's own vertical, and *"a big NOOOO"* is precisely the answer
  // that would give each half a different owner.
  const roots = connectedComponents(
    rings.length,
    shared.filter(([a, b]) => leftover[a] && leftover[b]),
  )
  const members = new Map<number, number[]>()
  for (let i = 0; i < rings.length; i++) {
    if (!leftover[i]) continue
    const list = members.get(roots[i])
    if (list === undefined) members.set(roots[i], [i])
    else list.push(i)
  }
  // THE WALLS — every classed face lying against the piece, gathered per
  // component before anything is chosen, so the decision reads the whole of the
  // boundary and not whichever face the arrangement emitted first.
  const walls = new Map<number, Set<number>>()
  for (const [a, b] of shared) {
    for (const [inside, outside] of [
      [a, b],
      [b, a],
    ]) {
      if (!leftover[inside] || leftover[outside]) continue
      const root = roots[inside]
      const list = walls.get(root)
      if (list === undefined) walls.set(root, new Set([outside]))
      else list.add(outside)
    }
  }
  for (const [root, component] of members) {
    const bounding = walls.get(root)
    if (bounding === undefined) continue
    let best: number | null = null
    for (const face of [...bounding].sort((p, q) => p - q)) {
      if (best === null) {
        best = face
        continue
      }
      const rank = faces[face].rank
      const bestRank = faces[best].rank
      // A mass whose packing key carries no class cannot be compared at all
      // (``nadClassRank`` answers null for it), so it never displaces one that
      // can; between two of those the lower-numbered face answers, which is a
      // canonical choice rather than the arrangement's own emit order.
      if (rank === null) continue
      if (bestRank === null || rank < bestRank) best = face
    }
    if (best === null) continue
    for (const face of component) owner[face] = best
  }
  return owner
}
