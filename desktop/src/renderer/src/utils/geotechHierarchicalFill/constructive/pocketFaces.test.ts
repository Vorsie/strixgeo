/**
 * THE POCKET RULE, on its own — the four readings of *"it should all be one
 * dense sand body?"* that ``pocketFaces.ts`` has to tell apart.
 *
 * The scene-level pin lives in ``pocketIsland.test.ts``, on the real engine.
 * These are the rule's own boundaries, stated where nothing else can move: one
 * case where it fires and three where it must not.
 *
 * @module utils/geotechHierarchicalFill/constructive/pocketFaces.test
 */
import { describe, expect, it } from 'vitest'

import { resolveIslands, type PocketFace } from './pocketFaces'

/** A ring from (fraction, elevation) pairs. */
const ring = (...points: [number, number][]): { fraction: number; elevation: number }[] =>
  points.map(([fraction, elevation]) => ({ fraction, elevation }))

const DENSE = 'sand|dense'
const MEDIUM = 'sand|medium'
const LOOSE = 'sand|loose'

/** The whole gap, tiled: four faces around a middle square, edges shared exactly. */
const ABOVE = ring([0, 0.6], [0.4, 0.6], [0.6, 0.6], [1, 0.6], [1, 1], [0, 1])
const BELOW = ring([0, 0], [1, 0], [1, 0.4], [0.6, 0.4], [0.4, 0.4], [0, 0.4])
const LEFT = ring([0, 0.4], [0.4, 0.4], [0.4, 0.6], [0, 0.6])
const RIGHT = ring([0.6, 0.4], [1, 0.4], [1, 0.6], [0.6, 0.6])
const MIDDLE = ring([0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6])

/** Both tests at the gap's own edges. */
const EDGES = { lo: 0, hi: 1 }

describe('a pocket belongs to the mass around it', () => {
  it('PF1: a face touching neither test, with one mass all round it, is that mass', () => {
    // The middle square reaches no column and every face against it is dense.
    const faces: PocketFace[] = [
      { key: DENSE, ring: ABOVE },
      { key: DENSE, ring: BELOW },
      { key: DENSE, ring: LEFT },
      { key: DENSE, ring: RIGHT },
      { key: MEDIUM, ring: MIDDLE },
    ]
    const owners = resolveIslands(faces, EDGES)
    expect(faces[owners[4]].key, 'the pocket kept a mass of its own').toBe(DENSE)
    expect(owners.slice(0, 4), 'the enclosing ground moved').toEqual([0, 1, 2, 3])
  })

  it('PF2: a face that REACHES a test is never a pocket, however enclosed it looks', () => {
    // The same tiling with the medium mass on the LEFT face instead: it runs to
    // the left-hand test, dense lies against it on all three other sides, and
    // it keeps every metre. This is the SF-silt fill-through in miniature —
    // contiguity from its own column is what tells it from an island.
    const faces: PocketFace[] = [
      { key: DENSE, ring: ABOVE },
      { key: DENSE, ring: BELOW },
      { key: MEDIUM, ring: LEFT },
      { key: DENSE, ring: RIGHT },
      { key: DENSE, ring: MIDDLE },
    ]
    expect(resolveIslands(faces, EDGES), 'the mass at its own test was absorbed').toEqual([
      0, 1, 2, 3, 4,
    ])
  })

  it('PF3: two masses against it enclose nothing, and it keeps what it had', () => {
    const faces: PocketFace[] = [
      { key: DENSE, ring: ABOVE },
      { key: DENSE, ring: BELOW },
      { key: LOOSE, ring: LEFT },
      { key: DENSE, ring: RIGHT },
      { key: MEDIUM, ring: MIDDLE },
    ]
    expect(resolveIslands(faces, EDGES), 'the rule invented an owner').toEqual([0, 1, 2, 3, 4])
  })

  it('PF4: ground adrift cannot swallow ground adrift', () => {
    // A litho cover that is a closed lens of its own reaches neither test, so
    // nothing inside it is anchored. Its contents are just its contents.
    const faces: PocketFace[] = [
      { key: DENSE, ring: ABOVE },
      { key: DENSE, ring: BELOW },
      { key: DENSE, ring: LEFT },
      { key: DENSE, ring: RIGHT },
      { key: MEDIUM, ring: MIDDLE },
    ]
    expect(
      resolveIslands(faces, { lo: -1, hi: 2 }),
      'an unanchored mass absorbed a pocket',
    ).toEqual([0, 1, 2, 3, 4])
  })

  it('PF5: a pocket inside a pocket keeps what it had — nothing there is enclosed', () => {
    // The rule asks for ONE mass all round, and neither of these has it: the
    // outer square has the dense sand on four sides and the inner square on the
    // fifth, and the inner square's only neighbour is ground that reaches no
    // test either. Conservative by construction, and the case does not arise on
    // real data — the alternative would be inventing a ruling.
    const inner = ring([0.45, 0.45], [0.55, 0.45], [0.55, 0.55], [0.45, 0.55])
    const holed = ring(
      [0.4, 0.4],
      [0.6, 0.4],
      [0.6, 0.6],
      [0.4, 0.6],
      [0.4, 0.4],
      [0.45, 0.45],
      [0.45, 0.55],
      [0.55, 0.55],
      [0.55, 0.45],
      [0.45, 0.45],
    )
    const faces: PocketFace[] = [
      { key: DENSE, ring: ABOVE },
      { key: DENSE, ring: BELOW },
      { key: DENSE, ring: LEFT },
      { key: DENSE, ring: RIGHT },
      { key: MEDIUM, ring: holed },
      { key: LOOSE, ring: inner },
    ]
    expect(resolveIslands(faces, EDGES), 'a nested pocket was re-owned').toEqual([0, 1, 2, 3, 4, 5])
  })
})
