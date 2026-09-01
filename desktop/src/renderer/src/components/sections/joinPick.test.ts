// Pure resolution for a "Join with…" target click (debt #278, geotech axis).
//
// When a Join is armed on body A and the engineer clicks a fill region, the
// region's layers name the OTHER body. These pins fix the four outcomes the arm
// has to tell apart, in the ruling's own words: "these two ARE the same body" —
// a DIFFERENT body of the SAME packing class commits; clicking the SAME body or
// an unresolvable region stays armed; a body of a DIFFERENT class cannot be one
// mass, so it is refused with a cross-class advisory (the backend would 422).

import { describe, expect, it } from 'vitest'

import { firstLayerStampedToBody, resolveJoinPick } from './joinPick'

const arm = { bodyId: 'body-A', anchorLayerId: 'a1' }

// firstLayerStampedToBody moved here when the Separate verb was retired
// (body-verb simplification, 2026-09-01); its pins move with it.
describe('firstLayerStampedToBody', () => {
  const map = new Map<string, string | null>([
    ['a1', 'body-A'],
    ['b1', 'body-B'],
    ['b2', 'body-B'],
    ['x1', null],
  ])

  it('FLS1 — returns the first layer stamped to the body, in order', () => {
    expect(firstLayerStampedToBody(['b1', 'b2'], 'body-B', map)).toBe('b1')
  })

  it('FLS2 — skips layers stamped to other bodies', () => {
    expect(firstLayerStampedToBody(['a1', 'b2'], 'body-B', map)).toBe('b2')
  })

  it('FLS3 — returns null when no layer belongs to the body', () => {
    expect(firstLayerStampedToBody(['a1', 'x1'], 'body-B', map)).toBeNull()
  })

  it('FLS4 — returns null for absent layerIds', () => {
    expect(firstLayerStampedToBody(undefined, 'body-A', map)).toBeNull()
  })
})

// Every layer here is ZAND·dicht except the KLEI anchor in JP6 — the class map
// is what tells same-class (join) from cross-class (refuse).
const SAME_CLASS = new Map<string, string>([
  ['a1', 'ZAND, dicht'],
  ['b1', 'ZAND, dicht'],
  ['b2', 'ZAND, dicht'],
  ['c1', 'ZAND, dicht'],
])

describe('resolveJoinPick', () => {
  it('JP1 — a DIFFERENT same-class body commits (arm anchor, target anchor)', () => {
    const map = new Map<string, string | null>([
      ['a1', 'body-A'],
      ['b1', 'body-B'],
      ['b2', 'body-B'],
    ])
    // Target anchor = the FIRST region layer stamped to the resolved target body.
    expect(resolveJoinPick(arm, ['b1', 'b2'], map, SAME_CLASS)).toEqual({
      kind: 'commit',
      anchorLayerId: 'a1',
      targetAnchorLayerId: 'b1',
    })
  })

  it('JP2 — the SAME body stays armed (no self-join)', () => {
    const map = new Map<string, string | null>([
      ['a1', 'body-A'],
      ['a2', 'body-A'],
    ])
    expect(resolveJoinPick(arm, ['a1', 'a2'], map, SAME_CLASS)).toEqual({ kind: 'same' })
  })

  it('JP3 — an unresolvable region (no stamped body) stays armed', () => {
    const map = new Map<string, string | null>([
      ['a1', 'body-A'],
      ['x1', null],
    ])
    expect(resolveJoinPick(arm, ['x1'], map, SAME_CLASS)).toEqual({ kind: 'unresolvable' })
  })

  it('JP4 — a region spanning several bodies is unresolvable (stays armed)', () => {
    const map = new Map<string, string | null>([
      ['a1', 'body-A'],
      ['b1', 'body-B'],
      ['c1', 'body-C'],
    ])
    expect(resolveJoinPick(arm, ['b1', 'c1'], map, SAME_CLASS)).toEqual({ kind: 'unresolvable' })
  })

  it('JP5 — fallback paint (no layerIds) is unresolvable', () => {
    const map = new Map<string, string | null>([['a1', 'body-A']])
    expect(resolveJoinPick(arm, undefined, map, SAME_CLASS)).toEqual({ kind: 'unresolvable' })
  })

  it('JP6 — a DIFFERENT-class body is cross-class, carrying both class labels', () => {
    // A body cannot be a mixed mass; the backend refuses such a join 422. The
    // client pre-empts the round-trip with an advisory naming both classes.
    const map = new Map<string, string | null>([
      ['a1', 'body-A'],
      ['k1', 'body-K'],
    ])
    const classes = new Map<string, string>([
      ['a1', 'ZAND, dicht'],
      ['k1', 'KLEI, stevig'],
    ])
    expect(resolveJoinPick(arm, ['k1'], map, classes)).toEqual({
      kind: 'cross-class',
      classA: 'ZAND, dicht',
      classB: 'KLEI, stevig',
    })
  })

  it('JP7 — an unknown class on either side falls through to commit (backend is the authority)', () => {
    // classByLayerId can lack a layer (map race); rather than block a legal join
    // on missing data the client commits and lets the write guard decide.
    const map = new Map<string, string | null>([
      ['a1', 'body-A'],
      ['b1', 'body-B'],
    ])
    expect(resolveJoinPick(arm, ['b1'], map, new Map())).toEqual({
      kind: 'commit',
      anchorLayerId: 'a1',
      targetAnchorLayerId: 'b1',
    })
  })
})
